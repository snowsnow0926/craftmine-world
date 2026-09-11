const messages = {
  BACKUP_PROGRESS_CHANGED_REINSPECT: '当前世界有未保存的进度。请先保存，再重新选择并检查备份后恢复。',
  WORLD_BUSY: '世界正在处理其他操作，请等待完成后再试。',
  ACTIVE_TASK_EXISTS: '创作或世界操作仍在进行，请等待完成后再试。',
  BACKUP_OPERATION_FAILED: '备份操作未完成，请重新检查备份后再试。',
  BACKUP_RESTORED_RECONCILIATION_PENDING: '备份资料已恢复，但世界启动或界面交接尚未完成。请重新打开应用继续，不要再次恢复这份备份。',
  BACKUP_ALREADY_ACTIVATED: '备份资料已经恢复，不能取消这次恢复。世界启动或界面交接如未完成，请重新打开应用继续。',
};

/** Only the host's confirmed activation result permits this partial outcome. */
export function backupRestorePendingMessage(result) {
  return result?.status === 'reconciliation-pending' && result?.activated === true && result?.errorCode === 'BACKUP_RESTORED_RECONCILIATION_PENDING'
    ? messages.BACKUP_RESTORED_RECONCILIATION_PENDING : null;
}

/** Fixed hints only; never extract a code from arbitrary private error text. */
export function backupErrorMessage(error) {
  const code = error?.errorCode ?? error?.code;
  if (typeof code === 'string' && Object.hasOwn(messages, code)) return messages[code];
  const text = typeof error === 'string' ? error : error?.message;
  for (const [known, message] of Object.entries(messages)) {
    if ([known, `Error: ${known}`, `Error invoking remote method 'pi-plugin-panel-invoke': Error: ${known}`].includes(text)) return message;
  }
  return null;
}
