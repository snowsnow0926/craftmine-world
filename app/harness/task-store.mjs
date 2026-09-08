import fs from 'node:fs';
import path from 'node:path';
import { atomicJSON } from '../store.mjs';
import { contentHash, integer, requireValue } from './contracts.mjs';

// 任务记录（P1）：计划、证据和「完成回执」都由宿主落盘。
// 模型可以提出计划、提交证据、请求结束；但「能不能算完成」由宿主按固定条件判定。
export const TASK_RECORD_FORMAT = 'craftmine.task-record/1';
export const TASK_LIMITS = Object.freeze({ steps: 12, stepText: 200, summary: 1000, evidence: 32, evidenceBytes: 64000 });

const taskPattern = /^[a-f0-9-]{36}$/;
const namePattern = /^[a-z][a-z0-9-]{0,47}$/;
const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export class TaskStore {
  constructor(store, { id }) {
    requireValue(taskPattern.test(id) && store.data.tasks.some(task => task.id === id), 'INVALID_TASK', '开发任务不存在');
    this.store = store;
    this.id = id;
    this.root = fs.realpathSync(store.root);
    this.dir = this.safePath('tasks', id);
    this.file = this.safePath('tasks', id, 'task.json');
    this.evidenceDir = this.safePath('tasks', id, 'evidence');
  }
  safePath(...parts) {
    let current = this.root;
    for (const part of parts) {
      requireValue(typeof part === 'string' && part !== '.' && part !== '..' && !/[\\/:]/.test(part), 'INVALID_PATH', '任务路径无效');
      current = path.join(current, part);
      if (fs.existsSync(current)) requireValue(!fs.lstatSync(current).isSymbolicLink(), 'INVALID_PATH', '任务资源不能经过符号链接或目录联接');
    }
    return current;
  }
  read() {
    if (!fs.existsSync(this.file)) {
      const record = { format: TASK_RECORD_FORMAT, taskId: this.id, plan: [], evidence: [], finished: null };
      fs.mkdirSync(this.dir, { recursive: true });
      atomicJSON(this.file, record);
      return record;
    }
    const record = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    requireValue(record.format === TASK_RECORD_FORMAT && record.taskId === this.id, 'INVALID_TASK_RECORD', '任务记录格式不兼容');
    return record;
  }
  write(record) { atomicJSON(this.file, record); return record; }
  assertOpen(record = this.read()) {
    requireValue(!record.finished, 'TASK_FINISHED', '任务已经提交完成回执，不能再改计划或证据');
    return record;
  }
  // 计划：模型提议的步骤，宿主只做结构校验；完成状态由证据和宿主判定。
  plan(steps) {
    requireValue(Array.isArray(steps) && steps.length >= 1 && steps.length <= TASK_LIMITS.steps, `计划需要 1–${TASK_LIMITS.steps} 步`);
    const record = this.assertOpen();
    const normalized = steps.map((step, index) => {
      const value = typeof step === 'string' ? { text: step } : step;
      requireValue(isPlain(value) && text(value.text, TASK_LIMITS.stepText), `第 ${index + 1} 步的计划内容无效`);
      requireValue(value.status === undefined || ['todo', 'doing', 'done', 'dropped'].includes(value.status), `第 ${index + 1} 步的状态无效`);
      return { id: `step-${index + 1}`, text: value.text.trim(), status: value.status || 'todo' };
    });
    return this.write({ ...record, plan: normalized });
  }
  updateStep(id, status, { note = '' } = {}) {
    const record = this.assertOpen();
    requireValue(['doing', 'done', 'dropped'].includes(status), '步骤状态无效');
    requireValue(record.plan.some(step => step.id === id), 'NOT_FOUND', '计划里没有这一步：' + id);
    const plan = record.plan.map(step => step.id === id ? { ...step, status, ...(note ? { note: note.slice(0, TASK_LIMITS.stepText) } : {}) } : step);
    return this.write({ ...record, plan });
  }
  // 证据：先落盘原件，读取时再分段，不能只留一句「已验证」。
  recordEvidence(name, value) {
    requireValue(namePattern.test(name || ''), 'INVALID_ARGUMENTS', '证据名无效');
    const record = this.assertOpen();
    requireValue(record.evidence.length < TASK_LIMITS.evidence, 'EVIDENCE_LIMIT', '证据数量已达上限');
    const payload = JSON.stringify(value);
    requireValue(payload.length <= TASK_LIMITS.evidenceBytes, 'EVIDENCE_TOO_LARGE', `证据超过 ${TASK_LIMITS.evidenceBytes} 字符上限`);
    fs.mkdirSync(this.evidenceDir, { recursive: true });
    const file = this.safePath('tasks', this.id, 'evidence', name + '.json');
    atomicJSON(file, value);
    const ref = `evidence:${this.id}:${name}`;
    const entry = { ref, name, hash: contentHash(value), chars: payload.length, at: Date.now() };
    const evidence = [...record.evidence.filter(item => item.ref !== ref), entry];
    this.write({ ...record, evidence });
    return { ref, hash: entry.hash, chars: entry.chars };
  }
  readEvidence(ref, { start = 0, limit = 4000 } = {}) {
    const name = String(ref || '').startsWith(`evidence:${this.id}:`) ? String(ref).slice(`evidence:${this.id}:`.length) : null;
    requireValue(name && namePattern.test(name), 'INVALID_ARGUMENTS', '证据引用无效');
    integer(start, 0, TASK_LIMITS.evidenceBytes, '读取起点');
    integer(limit, 1, 4000, '读取长度');
    const file = this.safePath('tasks', this.id, 'evidence', name + '.json');
    requireValue(fs.existsSync(file), 'NOT_FOUND', '证据不存在：' + ref);
    const chars = Array.from(fs.readFileSync(file, 'utf8'));
    requireValue(start <= chars.length, 'INVALID_ARGUMENTS', '读取起点超过证据末尾');
    const end = Math.min(chars.length, start + limit);
    return { ref, hash: contentHash(JSON.parse(chars.join(''))), text: chars.slice(start, end).join(''), start, next: end < chars.length ? end : null, totalChars: chars.length };
  }
  // 完成回执：宿主固定条件，模型无权自己宣布完成。
  finish({ summary, candidateRef = null, noChangeReason = null, evidenceRefs = [] } = {}) {
    const record = this.assertOpen();
    requireValue(record.plan.length >= 1, 'NO_PLAN', '还没有计划：先写清楚要做什么，再谈完成');
    const open = record.plan.filter(step => !['done', 'dropped'].includes(step.status));
    requireValue(open.length === 0, 'OPEN_STEPS', `还有 ${open.length} 步没有结束：${open.map(step => step.id + ' ' + step.text).join('；')}`);
    requireValue(text(summary, TASK_LIMITS.summary), 'INVALID_ARGUMENTS', '完成说明无效或过长');
    requireValue(Array.isArray(evidenceRefs) && evidenceRefs.length >= 1, 'NO_EVIDENCE', '完成必须有证据：先记录工具回执或验收结果');
    for (const ref of evidenceRefs) requireValue(record.evidence.some(item => item.ref === ref), 'NOT_FOUND', '证据不存在：' + ref);
    requireValue(text(candidateRef, 120) || text(noChangeReason, 400), 'NO_RESULT', '完成要么给出候选引用，要么说明为什么这次没有改动');
    const receipt = {
      format: 'craftmine.task-receipt/1', taskId: this.id, summary: summary.trim(),
      candidateRef: candidateRef || null, noChangeReason: noChangeReason || null,
      evidenceRefs: [...evidenceRefs], plan: record.plan.map(step => ({ id: step.id, status: step.status })), at: Date.now(),
    };
    this.write({ ...record, finished: receipt });
    return receipt;
  }
  text(record = this.read()) {
    const lines = [`任务 ${this.id}：${record.finished ? '已提交完成回执' : '进行中'}`];
    for (const step of record.plan) lines.push(`- [${step.status}] ${step.id} ${step.text}`);
    if (record.evidence.length) lines.push(`证据：${record.evidence.map(item => `${item.name}(${item.chars} 字符)`).join('、')}`);
    if (record.finished) lines.push(`回执：${record.finished.summary}`);
    return lines.join('\n');
  }
}
