// Local player reports. Text and version identity are retained by Main.
const messages = {
  ISSUE_INVALID_INPUT: '问题描述不能为空，最多 4096 字。',
  ISSUE_CONTEXT_UNAVAILABLE: '请先打开一个已能游玩的 Godot 世界。',
  ISSUE_CONTEXT_NOT_READY: '请先结束候选试玩，并等待正式世界加载完成。',
  ISSUE_WORLD_CHANGED: '世界或版本已改变，请重新查看记录后再提交。',
  SELECTED_WORLD_CHANGED: '所选世界已改变，请重新打开记录簿。',
  ISSUE_NOT_FOUND: '这条记录已不存在，请刷新列表。',
  ISSUE_OPERATION_CONFLICT: '这次提交的内容已改变，请刷新后重新记录。',
  ISSUE_CAPACITY_REACHED: '本地记录簿已满，请删除不再需要的记录后再试。',
  ISSUE_RECEIPT_CAPACITY_REACHED: '此记录簿已达到累计记录上限；现有记录仍可查看和删除，删除不会恢复可记录次数。',
  ISSUE_BUSY: '记录簿正在处理另一项操作，请稍后重试。',
  ISSUE_STORAGE_INVALID: '本地记录簿无法读取，原文件已保留。',
  ISSUE_STORAGE_UNAVAILABLE: '本地记录未能保存或读取，请检查磁盘空间后重试。',
  ISSUE_REVISION_CHANGED: '记录已有新的补充，请重新查看后再提交。',
  ISSUE_STATE_CONFLICT: '复测状态已变化，请重新查看记录。',
  ISSUE_FOLLOWUP_CAPACITY_REACHED: '这条问题已达到 32 条补充上限，已有内容仍可查看。',
};
const playerLabels = {recorded:'尚未复测', 'still-present':'玩家复测：仍有问题', 'player-resolved':'玩家复测：已解决', reopened:'玩家重新打开'};
const followupLabels = {note:'补充说明', 'still-present':'仍有问题', 'player-resolved':'复测已解决', reopened:'重新打开'};
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
  const pendingFollowups = new Map();
  let detailSequence = 0;
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
  async function renderRecord(record, response = {}) {
    const sequence = ++detailSequence, generation = epoch, worldId = mountedWorld;
    detail.replaceChildren(); detail.hidden = false; detail.dataset.issueId = record.id;
    detail.append(text('h3', '问题原话'), text('p', record.description, 'issue-description'));
    detail.append(text('p', playerLabels[response.playerStatus] || playerLabels.recorded, 'workbench-meta'));
    detail.append(text('p', '以下复测状态由玩家主动标记，不代表自动诊断或验证通过。', 'workbench-meta'));
    const version = document.createElement('details'); version.append(text('summary', '记录时间与世界版本'));
    const c = record.context;
    for (const [label, value] of [['记录时间', record.createdAt], ['世界', c.worldId], ['构建', c.buildId], ['底座', `${c.baseId} ${c.baseVersion}`], ['运行实例', c.instanceId], ['运行方式', '正式世界 · Godot Web'], ['客户端', record.client?.version ?? '未记录']]) {
      version.append(text('p', `${label}：${value}`));
    }
    detail.append(version);
    const followups = response.followups ?? [];
    const history = document.createElement('section'); history.dataset.issueFollowups = 'true';
    history.append(text('h3', `补充与复测（${followups.length} / 32）`));
    for (const entry of followups) {
      const row = document.createElement('article'); row.dataset.issueFollowupId = entry.id;
      row.append(text('h4', followupLabels[entry.kind] || entry.kind), text('p', entry.text, 'issue-description'));
      row.append(text('p', `补充时间：${entry.createdAt} · 当时世界：${entry.context.worldId} · 构建：${entry.context.buildId} · 实例：${entry.context.instanceId}`, 'workbench-meta'));
      history.append(row);
    }
    detail.append(history);
    const appendArea = document.createElement('section'); appendArea.dataset.issueFollowupEditor = 'true'; detail.append(appendArea);
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
    let prepared;
    try {
      const pending = pendingFollowups.get(record.id);
      prepared = pending?.prepared ?? await call('issue.followupPrepare', {issueId: record.id});
    } catch (error) {
      if (current(generation, worldId) && sequence === detailSequence) appendArea.append(text('p', messages[error?.code] || messages[error?.message] || '补充入口暂时不可用，请稍后重新查看记录。'));
      return;
    }
    if (!current(generation, worldId) || sequence !== detailSequence) return;
    if (prepared.issueId !== record.id || prepared.context?.worldId !== worldId) { appendArea.append(text('p', messages.ISSUE_WORLD_CHANGED)); return; }
    if (prepared.revision !== (response.revision ?? 0) && !pendingFollowups.has(record.id)) { appendArea.append(text('p', messages.ISSUE_REVISION_CHANGED)); return; }
    if (followups.length >= 32 && !pendingFollowups.has(record.id)) { appendArea.append(text('p', messages.ISSUE_FOLLOWUP_CAPACITY_REACHED)); return; }
    appendArea.append(text('p', `本次补充现场：${prepared.context.buildId} · ${prepared.context.instanceId}。原始现场保持不变。`, 'workbench-meta'));
    const textarea = document.createElement('textarea'); textarea.maxLength = 2048; textarea.rows = 3; textarea.dataset.issueFollowupText = 'true'; textarea.setAttribute('aria-label', '补充说明（最多 2048 字）');
    const kind = document.createElement('select'); kind.dataset.issueFollowupKind = 'true'; kind.setAttribute('aria-label', '补充或复测状态');
    for (const [value, label] of Object.entries(followupLabels)) {
      if (value !== 'note' && ((prepared.playerStatus === 'player-resolved') !== (value === 'reopened'))) continue;
      const option = text('option', label); option.value = value; kind.append(option);
    }
    const pending = pendingFollowups.get(record.id);
    textarea.value = pending?.input.text ?? ''; textarea.readOnly = !!pending;
    kind.value = pending?.input.kind ?? 'note'; kind.disabled = !!pending;
    const submit = formButton(pending ? '重试原补充' : '保存补充与复测', () => run(async () => {
      if (!pendingFollowups.has(record.id)) {
        if (kind.value === 'note' && !textarea.value.trim()) throw Error('ISSUE_INVALID_INPUT');
        pendingFollowups.set(record.id, {prepared, input:{issueId:record.id, operationId:crypto.randomUUID(), revision:prepared.revision, contextHash:prepared.contextHash, kind:kind.value, text:textarea.value}});
      }
      const attempt = pendingFollowups.get(record.id); textarea.readOnly = true; kind.disabled = true;
      let result;
      try { result = await call('issue.followup', attempt.input); }
      catch (error) {
        if (current(generation, worldId) && ['ISSUE_INVALID_INPUT','ISSUE_CONTEXT_UNAVAILABLE','ISSUE_CONTEXT_NOT_READY','ISSUE_WORLD_CHANGED','ISSUE_REVISION_CHANGED','ISSUE_STATE_CONFLICT','ISSUE_NOT_FOUND','ISSUE_FOLLOWUP_CAPACITY_REACHED','ISSUE_CAPACITY_REACHED','ISSUE_RECEIPT_CAPACITY_REACHED'].includes(error?.code || error?.message)) {
          pendingFollowups.delete(record.id); textarea.readOnly = false; kind.disabled = false;
        } else submit.button.textContent = '重试原补充';
        throw error;
      }
      if (result?.status !== 'completed') { submit.button.textContent = '重试原补充'; throw Error('UNCONFIRMED'); }
      pendingFollowups.delete(record.id); await refresh();
      if (result.issue) await renderRecord(result.issue, result); else detail.hidden = true;
      status(result.deleted ? '这条记录已被删除，原补充不会重新创建记录。' : '补充已保存在本地；复测状态仅代表你的反馈。');
    }));
    submit.form.prepend(kind, textarea); appendArea.append(submit.form);
  }
  async function refresh() {
    const sequence = ++readSequence;
    let result;
    try { result = await call('issue.list', {offset, limit: 20}); }
    catch (error) { if (sequence !== readSequence) return; throw error; }
    if (sequence !== readSequence) return;
    list.replaceChildren(); total.textContent = `此世界 ${result.total} 条记录`;
    if (Number.isSafeInteger(result.remainingCreateSlots)) total.textContent += ` · 本地累计额度最多还可记录 ${result.remainingCreateSlots} 次`;
    if (!result.items.length) list.append(text('p', '还没有记录问题。', 'workbench-empty'));
    for (const item of result.items) {
      const row = document.createElement('article'); row.className = 'workbench-card'; row.dataset.issueId = item.id;
      row.append(text('p', item.descriptionPreview, 'issue-description'), text('p', `${item.createdAt} · ${playerLabels[item.playerStatus] || playerLabels.recorded}`, 'workbench-meta'));
      row.append(formButton('查看记录', () => run(async () => { const result = await call('issue.read', {issueId: item.id}); await renderRecord(result.issue, result); })).form);
      list.append(row);
    }
    if (offset > 0) list.append(formButton('上一页记录', () => run(async () => { offset = Math.max(0, offset - 20); await refresh(); })).form);
    if (result.nextOffset !== null) list.append(formButton('下一页记录', () => run(async () => { offset = result.nextOffset; await refresh(); })).form);
  }
  async function show() {
    epoch++; mountedWorld = getWorldId(); busy = false; offset = 0;
    const generation = epoch, worldId = mountedWorld;
    if (pendingCreate?.worldId !== mountedWorld) pendingCreate = null;
    for (const [id, pending] of pendingFollowups) if (pending.prepared.context.worldId !== mountedWorld) pendingFollowups.delete(id);
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
      if (result.issue) await renderRecord(result.issue);
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
  function clear() { epoch++; readSequence++; detailSequence++; mountedWorld = null; busy = false; element.replaceChildren(); }
  return {show, clear};
}
