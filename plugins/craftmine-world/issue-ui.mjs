// Local player reports. Text and version identity are retained by Main.
const messages = {
  ISSUE_INVALID_INPUT: '问题描述不能为空，最多 4096 字。',
  ISSUE_CONTEXT_UNAVAILABLE: '请先打开一个已能游玩的 Godot 世界。',
  ISSUE_CONTEXT_NOT_READY: '请先结束候选试玩，并等待正式世界加载完成。',
  ISSUE_WORLD_CHANGED: '世界或版本已改变，请在对应世界重新记录。',
  SELECTED_WORLD_CHANGED: '所选世界已改变，请重新打开记录簿。',
  ISSUE_NOT_FOUND: '这条记录已不存在，请刷新列表。',
  ISSUE_OPERATION_CONFLICT: '这次提交的内容已改变，请刷新后重新记录。',
  ISSUE_CAPACITY_REACHED: '本地记录簿已满，请删除不再需要的记录后再试。',
  ISSUE_RECEIPT_CAPACITY_REACHED: '此记录簿已达到累计记录上限；现有记录仍可查看和删除，删除不会恢复可记录次数。',
  ISSUE_BUSY: '记录簿正在处理另一项操作，请稍后重试。',
  ISSUE_STORAGE_INVALID: '本地记录簿无法读取，原文件已保留。',
  ISSUE_STORAGE_UNAVAILABLE: '本地记录未能保存或读取，请检查磁盘空间后重试。',
};
const text = (tag, value, className) => {
  const node = document.createElement(tag); node.textContent = value ?? '';
  if (className) node.className = className; return node;
};
const formButton = (label, fn) => {
  const form = document.createElement('form'), button = text('button', label);
  button.type = 'submit'; form.append(button);
  form.onsubmit = event => { event.preventDefault(); void fn(); };
  return {form, button};
};

export function createIssueUI({element, request, getWorldId, action = fn => fn()}) {
  let epoch = 0, readSequence = 0, mountedWorld = null, busy = false, offset = 0, pendingCreate = null;
  let description, list, detail, notice, total;
  const deletions = new Map();
  function current(generation, worldId) { return generation === epoch && worldId === mountedWorld && worldId === getWorldId(); }
  function status(value, error = false) { notice.textContent = value; notice.dataset.error = String(error); }
  async function call(channel, payload = {}) {
    const generation = epoch, worldId = mountedWorld;
    if (!worldId || worldId !== getWorldId()) throw Error('ISSUE_WORLD_CHANGED');
    const value = await request(channel, {worldId, ...payload});
    if (!current(generation, worldId)) throw Error('ISSUE_WORLD_CHANGED');
    return value;
  }
  async function run(fn) {
    if (busy) return;
    return action(async () => {
      if (busy) return;
      const generation = epoch, worldId = mountedWorld; busy = true;
      for (const button of element.querySelectorAll('button')) button.disabled = true;
      try { await fn(); }
      catch (error) {
        if (current(generation, worldId)) status(messages[error?.code] || messages[error?.message] || '结果尚未确认，请重试原操作或刷新记录列表。', true);
      } finally {
        if (current(generation, worldId)) {
          busy = false;
          for (const button of element.querySelectorAll('button')) button.disabled = false;
        }
      }
    });
  }
  function renderRecord(record) {
    detail.replaceChildren(); detail.hidden = false; detail.dataset.issueId = record.id;
    detail.append(text('h3', '问题原话'), text('p', record.description, 'issue-description'));
    detail.append(text('p', '已记录 · 尚未复现或确认解决', 'workbench-meta'));
    const version = document.createElement('details'); version.append(text('summary', '记录时间与世界版本'));
    const c = record.context;
    for (const [label, value] of [['记录时间', record.createdAt], ['世界', c.worldId], ['构建', c.buildId], ['底座', `${c.baseId} ${c.baseVersion}`], ['运行实例', c.instanceId], ['运行方式', '正式世界 · Godot Web'], ['客户端', record.client?.version ?? '未记录']]) {
      version.append(text('p', `${label}：${value}`));
    }
    detail.append(version);
    const confirm = document.createElement('section'); confirm.hidden = true;
    const open = formButton('删除这条记录', () => { confirm.hidden = false; });
    const remove = formButton('确认删除记录', () => run(async () => {
      let operationId = deletions.get(record.id);
      if (!operationId) { operationId = crypto.randomUUID(); deletions.set(record.id, operationId); }
      const result = await call('issue.delete', {issueId: record.id, operationId});
      if (result?.status !== 'completed' || result.deleted !== true) throw Error('UNCONFIRMED');
      detail.hidden = true; offset = 0; await refresh(); status('记录已删除。');
    }));
    const cancel = formButton('保留记录', () => { confirm.hidden = true; });
    confirm.append(text('p', '删除后无法恢复；世界和游玩进度不受影响。'), remove.form, cancel.form);
    detail.append(open.form, confirm);
  }
  async function refresh() {
    const sequence = ++readSequence;
    let result;
    try { result = await call('issue.list', {offset, limit: 20}); }
    catch (error) { if (sequence !== readSequence) return; throw error; }
    if (sequence !== readSequence) return;
    list.replaceChildren(); total.textContent = `此世界 ${result.total} 条记录`;
    if (result.limits?.maxCreatedRecords !== undefined && result.usage?.createdRecords !== undefined) total.textContent += ` · 本地还可记录 ${Math.max(0, result.limits.maxCreatedRecords - result.usage.createdRecords)} 次`;
    if (!result.items.length) list.append(text('p', '还没有记录问题。', 'workbench-empty'));
    for (const item of result.items) {
      const row = document.createElement('article'); row.className = 'workbench-card'; row.dataset.issueId = item.id;
      row.append(text('p', item.descriptionPreview, 'issue-description'), text('p', item.createdAt, 'workbench-meta'));
      row.append(formButton('查看记录', () => run(async () => renderRecord((await call('issue.read', {issueId: item.id})).issue))).form);
      list.append(row);
    }
    if (offset > 0) list.append(formButton('上一页记录', () => run(async () => { offset = Math.max(0, offset - 20); await refresh(); })).form);
    if (result.nextOffset !== null) list.append(formButton('下一页记录', () => run(async () => { offset = result.nextOffset; await refresh(); })).form);
  }
  async function show() {
    epoch++; mountedWorld = getWorldId(); busy = false; offset = 0;
    const generation = epoch, worldId = mountedWorld;
    if (pendingCreate?.worldId !== mountedWorld) pendingCreate = null;
    element.replaceChildren(text('h2', '本地问题记录'));
    element.append(text('p', '仅保存在此客户端，不包含在世界备份中。记录原话和正式世界版本；不附截图、聊天或存档。', 'workbench-meta'));
    const label = document.createElement('label'); label.append(text('span', '遇到了什么问题？'));
    description = document.createElement('textarea'); description.maxLength = 4096; description.rows = 3; description.required = true;
    description.value = pendingCreate?.description ?? ''; description.dataset.issueDescription = 'true'; label.append(description);
    const create = formButton('记录问题', () => run(async () => {
      const value = description.value;
      if (!value.trim() || value.length > 4096) throw Error('ISSUE_INVALID_INPUT');
      if (pendingCreate && pendingCreate.description !== value) throw Error('ISSUE_OPERATION_CONFLICT');
      pendingCreate ??= {worldId: mountedWorld, operationId: crypto.randomUUID(), description: value};
      description.readOnly = true;
      let result;
      try { result = await call('issue.create', {operationId: pendingCreate.operationId, description: pendingCreate.description}); }
      catch (error) {
        if (current(generation, worldId) && ['ISSUE_INVALID_INPUT', 'ISSUE_CONTEXT_UNAVAILABLE', 'ISSUE_CONTEXT_NOT_READY', 'ISSUE_WORLD_CHANGED', 'ISSUE_CAPACITY_REACHED', 'ISSUE_RECEIPT_CAPACITY_REACHED'].includes(error?.code || error?.message)) {
          pendingCreate = null; description.readOnly = false;
        }
        throw error;
      }
      if (result?.status !== 'completed') throw Error('UNCONFIRMED');
      pendingCreate = null; description.readOnly = false; description.value = ''; offset = 0; await refresh();
      if (result.issue) renderRecord(result.issue);
      status(result.deleted ? '这条记录已被删除。' : '问题已保存在本地，尚未复现或确认解决。');
    })); create.form.className = 'issue-create'; create.form.prepend(label); element.append(create.form);
    description.readOnly = !!pendingCreate;
    element.append(formButton('另写一条问题', () => run(async () => {
      await refresh(); pendingCreate = null; description.readOnly = false; description.value = '';
      status('请先核对已有记录，避免重复记录同一个问题。');
    })).form);
    notice = text('p', '', 'workbench-notice'); notice.setAttribute('role', 'status');
    total = text('p', '', 'workbench-meta'); list = document.createElement('div'); detail = document.createElement('section'); detail.hidden = true;
    const reload = formButton('刷新问题记录', () => run(async () => {
      await refresh(); status('已读取本地记录。');
    }));
    element.append(notice, total, reload.form, list, detail);
    try { await refresh(); }
    catch (error) { if (current(generation, worldId)) status(messages[error?.code] || messages[error?.message] || '本地记录暂时无法读取，请重试。', true); }
  }
  function clear() { epoch++; readSequence++; mountedWorld = null; busy = false; element.replaceChildren(); }
  return {show, clear};
}
