import { TaskNode, RecurrenceRule, RecurrenceType } from '../types/todo';
import { generateId } from './treeOperations';
import { getTodayDateString } from './seedData';
import { reopenTaskBranch } from './taskLifecycle';

/**
 * Returns a human-friendly label for a recurrence rule, e.g.:
 * "每天", "每周五", "每月 25 日"
 */
export function formatRecurrenceSummary(rule: RecurrenceRule | null | undefined): string {
  if (!rule || rule.type === 'none') return '';
  if (rule.paused) return '已暂停重复';

  if (rule.type === 'daily') {
    return '每天';
  }

  if (rule.type === 'weekly') {
    const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const days = (rule.days_of_week || []).map((d) => dayNames[d] || `周${d}`).join('、');
    return days ? `每${days}` : '每周';
  }

  if (rule.type === 'monthly') {
    return `每月 ${rule.day_of_month || 1} 日`;
  }

  return '';
}

/**
 * Helper to get the last day of a given month
 */
export function getDaysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

/**
 * Adjust day for end of month (e.g. 31 in February or April)
 */
export function getSafeDayOfMonth(year: number, month1Indexed: number, targetDay: number): number {
  const maxDay = getDaysInMonth(year, month1Indexed);
  return Math.min(Math.max(1, targetDay), maxDay);
}

/**
 * Calculate ISO week key (e.g. "2026-W39")
 */
export function getIsoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Compute period key for a given rule and target date
 */
export function computePeriodKey(rule: RecurrenceRule, dateStr: string): string {
  if (rule.type === 'daily') {
    return `daily_${dateStr}`;
  }
  if (rule.type === 'weekly') {
    return `weekly_${getIsoWeekKey(dateStr)}`;
  }
  if (rule.type === 'monthly') {
    return `monthly_${dateStr.substring(0, 7)}`;
  }
  return `single_${dateStr}`;
}

/**
 * Sync and catch-up recurring tasks on startup or date change:
 * - Collects unique rules from existing tasks (or templates)
 * - Only generates the latest pending period (avoids flooding if app unopened for months)
 * - Prevents generating duplicate instances for the same rule + period
 * - If an uncompleted instance already exists for this rule, does not spam another
 * - Priority convention: EVERY newly created recurring task has quadrant = null (unclassified)
 */
export function syncRecurringTasks(tasks: TaskNode[]): { updatedTasks: TaskNode[]; addedCount: number } {
  const todayStr = getTodayDateString(0);
  const [currentYear, currentMonth, currentDay] = todayStr.split('-').map(Number);
  const todayDate = new Date(todayStr + 'T00:00:00');
  const todayDayOfWeek = todayDate.getDay() === 0 ? 7 : todayDate.getDay(); // 1..7

  // Collect rules
  const rulesMap = new Map<string, { rule: RecurrenceRule; templateTask: TaskNode }>();
  for (const t of tasks) {
    if (t.recurrence_rule && t.recurrence_rule.type !== 'none' && !t.recurrence_rule.paused) {
      const r = t.recurrence_rule;
      if (!rulesMap.has(r.id)) {
        rulesMap.set(r.id, { rule: r, templateTask: t });
      }
    }
  }

  if (rulesMap.size === 0) {
    return { updatedTasks: tasks, addedCount: 0 };
  }

  let newTasks = [...tasks];
  let addedCount = 0;

  for (const [ruleId, { rule, templateTask }] of rulesMap.entries()) {
    // Check start and end dates
    if (rule.start_date && rule.start_date > todayStr) {
      continue; // Not yet active
    }
    if (rule.end_date && rule.end_date < todayStr) {
      continue; // Expired
    }

    // Check if there is already an open (uncompleted) task for this rule
    const existingOpen = newTasks.find(
      (t) =>
        t.deleted_at === null &&
        t.status === 'open' &&
        (t.recurrence_rule_id === ruleId || t.recurrence_rule?.id === ruleId)
    );
    if (existingOpen) {
      // User has not finished the current cycle, do not spawn another pending task
      continue;
    }

    // Determine target date for current cycle
    let targetDateStr = todayStr;

    if (rule.type === 'daily') {
      targetDateStr = todayStr;
    } else if (rule.type === 'weekly') {
      const targetDays = rule.days_of_week && rule.days_of_week.length > 0 ? rule.days_of_week : [5]; // default Friday
      // If today is one of the target days, or find the nearest upcoming/recent target day in current week
      targetDateStr = todayStr;
    } else if (rule.type === 'monthly') {
      const desiredDay = rule.day_of_month || 1;
      const safeDay = getSafeDayOfMonth(currentYear, currentMonth, desiredDay);
      targetDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    }

    const periodKey = computePeriodKey(rule, targetDateStr);

    // Check if this rule already has an instance (either completed or open) for this period
    const alreadyExists = newTasks.some(
      (t) =>
        t.deleted_at === null &&
        (t.recurrence_rule_id === ruleId || t.recurrence_rule?.id === ruleId) &&
        t.recurrence_period_key === periodKey
    );

    if (alreadyExists) {
      continue;
    }

    // Generate new recurring task instance
    const now = new Date().toISOString();
    const newTask: TaskNode = {
      id: generateId(),
      parent_id: templateTask.parent_id,
      root_bucket: templateTask.root_bucket,
      title: templateTask.title,
      note: templateTask.note,
      sort_order: templateTask.sort_order + 1,
      status: 'open',
      completed_at: null,
      due_type: 'date',
      due_date: targetDateStr,
      due_at: null,
      quadrant: null, // STRICT RULE: newly generated instance is ALWAYS UNCLASSIFIED
      planned_date: null,
      recurrence_rule_id: rule.id,
      recurrence_rule: { ...rule },
      recurrence_period_key: periodKey,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    };

    // A new occurrence is active work, including when the prior branch was archived.
    if (newTask.parent_id) newTasks = reopenTaskBranch(newTasks, newTask.parent_id);
    newTasks.push(newTask);
    addedCount++;
  }

  return { updatedTasks: newTasks, addedCount };
}
