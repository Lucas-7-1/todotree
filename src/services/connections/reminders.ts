import type { TaskNode, TaskReminderRule } from '../../types/todo';

export function validateReminder(value: unknown): asserts value is TaskReminderRule {
  const r = value as TaskReminderRule;
  if (!r || typeof r.enabled !== 'boolean' || typeof r.trigger_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(r.trigger_at) || !Number.isFinite(Date.parse(r.trigger_at)) || typeof r.revision !== 'string' || !r.revision || r.revision.length > 100 || typeof r.timezone !== 'string' || typeof r.exact !== 'boolean' || typeof r.hide_title !== 'boolean' || !Array.isArray(r.channels) || !r.channels.length || r.channels.length > 2 || new Set(r.channels).size !== r.channels.length || r.channels.some(c => !['local','feishu'].includes(c))) throw Error('提醒配置无效，请重新设置');
  try { new Intl.DateTimeFormat('en', {timeZone:r.timezone}); } catch {throw Error('提醒时区无效');}
  if(r.channels.includes('feishu') && !/^[a-f0-9]{64}$/.test(r.feishu_destination||''))throw Error('提醒目的地无效，请重新核对并保存');
}
export function reminderEligible(task: TaskNode, now = Date.now()) {
  return task.status === 'open' && !task.deleted_at && !task.archived_at && !!task.reminder?.enabled && Date.parse(task.reminder.trigger_at) > now;
}
export function pauseImportedReminders(tasks: TaskNode[]): TaskNode[] {
  return tasks.map(t => t.reminder?.enabled ? {...t,reminder:{...t.reminder,enabled:false,revision:crypto.randomUUID()}} : t);
}
