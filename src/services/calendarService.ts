import { TaskNode } from '../types/todo';
import { TaskEvent } from '../types/ai';

export interface CalendarDayCell {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number;   // 1 - 12
  day: number;     // 1 - 31
  isCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  leafCompletedCount: number;  // 完成 N 条 (末级或无子节点任务)
  branchClosureCount: number;  // 闭环 M 项 (有子节点的父任务)
  previews: string[];          // 最多 2 条简短标题
  hasMorePreviews: number;     // 剩余 +N 条
}

export interface DayCompletedItem {
  eventId: string;
  taskId: string;
  title: string;
  path: string;
  timeStr: string;
  completedAt: string;
  isLeaf: boolean;
  completionMethod: 'direct' | 'batch_with_parent' | 'auto_closure';
  outcomeNote?: string;
  isCurrentlyReopened: boolean;
}

export interface DayProjectGroup {
  projectId: string;
  projectTitle: string;
  items: DayCompletedItem[];
}

export interface CalendarDayDetail {
  dateStr: string;
  leafCompletedCount: number;
  branchClosureCount: number;
  projectGroups: DayProjectGroup[];
}

/**
 * Format a Date object to YYYY-MM-DD string in a specified timezone.
 */
export function formatDateInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Format timestamp to HH:mm in a specified timezone.
 */
export function formatTimeInTimezone(isoStr: string, timezone: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', {
      timeZone: timezone || 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

/**
 * Generate a 42-cell calendar grid for a given year & month (1-indexed month: 1-12)
 * Starting on Monday.
 */
export function generateMonthGrid(year: number, month: number, todayStr: string): CalendarDayCell[] {
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const dayOfWeek = firstDayOfMonth.getDay(); // 0 is Sunday, 1 is Monday...
  // Distance back to Monday (Monday = 0, Sunday = 6)
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const startDate = new Date(year, month - 1, 1 - mondayOffset);
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const cellYear = d.getFullYear();
    const cellMonth = d.getMonth() + 1;
    const cellDay = d.getDate();
    const cellDateStr = `${cellYear}-${String(cellMonth).padStart(2, '0')}-${String(cellDay).padStart(2, '0')}`;

    cells.push({
      dateStr: cellDateStr,
      year: cellYear,
      month: cellMonth,
      day: cellDay,
      isCurrentMonth: cellMonth === month && cellYear === year,
      isToday: cellDateStr === todayStr,
      isFuture: cellDateStr > todayStr,
      leafCompletedCount: 0,
      branchClosureCount: 0,
      previews: [],
      hasMorePreviews: 0,
    });
  }

  return cells;
}

/**
 * Filter out undone events. If a task has a task_uncompleted event in the same batch or later,
 * the corresponding completion event is excluded from historical calendar counts.
 */
export function filterEffectiveCompletionEvents(events: TaskEvent[]): TaskEvent[] {
  // Ledger order is authoritative: undo has its own operation id, not the completion id.
  const stacks = new Map<string, TaskEvent[]>();
  for (const event of events) {
    const key = event.instance_id || event.task_id;
    const stack = stacks.get(key) || [];
    if (event.event_type === 'task_completed') stack.push(event);
    else if (event.event_type === 'task_uncompleted') stack.pop();
    stacks.set(key, stack);
  }
  return [...stacks.values()].flat();
}

/**
 * Aggregate completion events across the month grid cells.
 */
export function aggregateMonthEvents(
  events: TaskEvent[],
  cells: CalendarDayCell[],
  timezone: string,
  currentTasks: TaskNode[],
  projectFilter: string = 'all'
): CalendarDayCell[] {
  if (cells.length === 0) return cells;

  const validCompletions = filterEffectiveCompletionEvents(events);
  const minDate = cells[0].dateStr;
  const maxDate = cells[cells.length - 1].dateStr;

  // Group events by dateStr
  const eventsByDate = new Map<string, TaskEvent[]>();

  for (const e of validCompletions) {
    const dateStr = formatDateInTimezone(new Date(e.timestamp), timezone);
    if (dateStr < minDate || dateStr > maxDate) continue;

    // Apply project filter if selected
    if (projectFilter !== 'all') {
      const isMatch = e.path_ids_at_completion && e.path_ids_at_completion.includes(projectFilter);
      const isDirectRoot = e.task_id === projectFilter;
      if (!isMatch && !isDirectRoot) continue;
    }

    if (!eventsByDate.has(dateStr)) {
      eventsByDate.set(dateStr, []);
    }
    eventsByDate.get(dateStr)!.push(e);
  }

  return cells.map((cell) => {
    const dayEvents = eventsByDate.get(cell.dateStr) || [];
    let leafCount = 0;
    let closureCount = 0;
    const titles: string[] = [];

    // Distinct by task_id on the same day to avoid duplicate counting (PRD 3.4)
    const seenOnDay = new Set<string>();

    for (const e of dayEvents) {
      if (seenOnDay.has(e.task_id)) continue;
      seenOnDay.add(e.task_id);

      if (e.is_leaf_at_completion !== false) {
        leafCount++;
        if (titles.length < 2) {
          titles.push(e.title || '无标题任务');
        }
      } else {
        closureCount++;
      }
    }

    const more = Math.max(0, leafCount - titles.length);

    return {
      ...cell,
      leafCompletedCount: leafCount,
      branchClosureCount: closureCount,
      previews: titles,
      hasMorePreviews: more,
    };
  });
}

/**
 * Get detailed completion items for a specific date, grouped by project/category.
 */
export function getDayCompletionDetail(
  events: TaskEvent[],
  dateStr: string,
  timezone: string,
  currentTasks: TaskNode[],
  projectFilter: string = 'all'
): CalendarDayDetail {
  const validCompletions = filterEffectiveCompletionEvents(events);
  const dayEvents = validCompletions.filter((e) => {
    const dStr = formatDateInTimezone(new Date(e.timestamp), timezone);
    if (dStr !== dateStr) return false;
    if (projectFilter !== 'all') {
      const isMatch = e.path_ids_at_completion && e.path_ids_at_completion.includes(projectFilter);
      const isDirectRoot = e.task_id === projectFilter;
      if (!isMatch && !isDirectRoot) return false;
    }
    return true;
  });

  // Sort events chronologically by completion time
  dayEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Count batch occurrences to distinguish "随父任务批量完成"
  const batchCounts = new Map<string, number>();
  for (const e of dayEvents) {
    if (e.operation_batch_id) {
      batchCounts.set(e.operation_batch_id, (batchCounts.get(e.operation_batch_id) || 0) + 1);
    }
  }

  // Map of current active open tasks for "当前已重新开启" check
  const openTasksSet = new Set(
    currentTasks.filter((t) => !t.deleted_at && t.status === 'open').map((t) => t.id)
  );

  let leafCompletedCount = 0;
  let branchClosureCount = 0;

  // Group by root project
  const groupsMap = new Map<string, DayProjectGroup>();
  const seenTaskIds = new Set<string>();

  for (const e of dayEvents) {
    if (seenTaskIds.has(e.task_id)) continue;
    seenTaskIds.add(e.task_id);

    const isLeaf = e.is_leaf_at_completion !== false;
    if (isLeaf) {
      leafCompletedCount++;
    } else {
      branchClosureCount++;
    }

    // Determine completion method
    let method: 'direct' | 'batch_with_parent' | 'auto_closure' = 'direct';
    if (!isLeaf) {
      method = 'auto_closure';
    } else if (e.operation_batch_id && (batchCounts.get(e.operation_batch_id) || 0) > 1) {
      method = 'batch_with_parent';
    }

    // Path & Project title
    const pathTitles = e.path_titles_at_completion || [];
    const rootTitle = pathTitles.length > 0 ? pathTitles[0] : (e.path_ids_at_completion?.length ? '根任务' : '默认任务');
    const rootId = (e.path_ids_at_completion && e.path_ids_at_completion.length > 0)
      ? e.path_ids_at_completion[0]
      : 'default_project';

    const item: DayCompletedItem = {
      eventId: e.event_id,
      taskId: e.task_id,
      title: e.title || '无标题任务',
      path: pathTitles.join(' / '),
      timeStr: formatTimeInTimezone(e.timestamp, timezone),
      completedAt: e.timestamp,
      isLeaf,
      completionMethod: method,
      outcomeNote: e.outcome_note,
      isCurrentlyReopened: openTasksSet.has(e.task_id),
    };

    if (!groupsMap.has(rootId)) {
      groupsMap.set(rootId, {
        projectId: rootId,
        projectTitle: rootTitle,
        items: [],
      });
    }
    groupsMap.get(rootId)!.items.push(item);
  }

  return {
    dateStr,
    leafCompletedCount,
    branchClosureCount,
    projectGroups: Array.from(groupsMap.values()),
  };
}
