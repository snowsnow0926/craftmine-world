import fs from 'node:fs';

// 读取项目数据目录里的本地密钥文件（默认 <数据目录>/secrets.json）。
// 该目录已被 .gitignore 忽略，也不进入源码归档；已经存在的环境变量优先，不会被覆盖。
// 只返回被应用的键名，永不返回键值。
export function loadLocalConfig(file, env = process.env) {
  if (!fs.existsSync(file)) return [];
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw Error('本地密钥文件不是有效 JSON：' + error.message); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('本地密钥文件需要是 JSON 对象');
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw Error('本地密钥文件的键名无效：' + key);
    if (typeof value !== 'string' || !value.trim()) throw Error('本地密钥文件的值需要是非空字符串：' + key);
    if (env[key] === undefined) { env[key] = value; applied.push(key); }
  }
  return applied;
}
