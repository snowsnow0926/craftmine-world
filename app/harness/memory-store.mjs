import fs from 'node:fs';
import path from 'node:path';
import { atomicJSON } from '../store.mjs';
import { memoryRecord, retrieve } from './memory-records.mjs';
import { requireValue } from './contracts.mjs';

// 记忆库（P3）：只存通过校验的记录；同 ID 想改写必须显式声明替代关系。
export const KNOWLEDGE_FORMAT = 'craftmine.knowledge/1';

export class MemoryStore {
  constructor(store) {
    this.root = fs.realpathSync(store.root);
    this.dir = path.join(this.root, 'knowledge');
    this.file = path.join(this.dir, 'records.json');
  }
  read() {
    if (!fs.existsSync(this.file)) return { format: KNOWLEDGE_FORMAT, records: [] };
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.format !== KNOWLEDGE_FORMAT || !Array.isArray(data.records)) throw Error('记忆库格式不兼容，未覆盖原文件');
    return data;
  }
  write(records) { fs.mkdirSync(this.dir, { recursive: true }); atomicJSON(this.file, { format: KNOWLEDGE_FORMAT, records }); return records; }
  remember(input) {
    const incoming = memoryRecord(input);
    const data = this.read();
    const sameId = data.records.find(record => record.id === incoming.id);
    if (sameId && !incoming.supersedes.includes(sameId.id)) throw Error(`同 ID 记忆已存在：${incoming.id}。要改写请用新 ID，或在 supersedes 里写上它。`);
    for (const id of incoming.supersedes) requireValue(data.records.some(record => record.id === id), 'NOT_FOUND', '要替代的记忆不存在：' + id);
    const superseded = [...new Set([...incoming.supersedes, ...(sameId ? [sameId.id] : [])])];
    let records = data.records.map(record => superseded.includes(record.id) ? { ...record, supersededBy: incoming.id } : record);
    records = [...records.filter(record => record.id !== incoming.id), incoming];
    if (records.length > 512) throw Error('记忆库已达 512 条上限：请先停用或整理旧记录');
    this.write(records);
    return { id: incoming.id, status: incoming.status, superseded: superseded[0] || null, total: records.length };
  }
  search(query = {}) { return retrieve(this.read().records, query); }
  forget(id, { reason }) {
    const data = this.read();
    const found = data.records.find(record => record.id === id);
    if (!found) throw Error('记忆不存在：' + id);
    if (typeof reason !== 'string' || !reason.trim()) throw Error('停用记忆必须写明原因');
    this.write(data.records.map(record => record.id === id ? { ...record, status: 'retired', retiredReason: reason.trim() } : record));
    return { id, status: 'retired' };
  }
}
