import { TaskNode } from '../../types/todo';
import {
  AIReportType,
  ReportPeriod,
  ReportScope,
  CompletedRecord,
  ProjectContextItem,
  ContextNodeItem,
  FactsPackage,
  TaskEvent,
} from '../../types/ai';
import { getAncestorNodes } from '../treeOperations';

/**
 * Get date parts in specific IANA timezone
 */
export function getDatePartsInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  // Weekday mapping: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  const hour = parseInt(partMap.hour || '0', 10);
  const hourNormalized = hour === 24 ? 0 : hour;

  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10), // 1-12
    day: parseInt(partMap.day, 10),
    weekday: weekdayMap[partMap.weekday] || 1,
    hour: hourNormalized,
    minute: parseInt(partMap.minute, 10),
    second: parseInt(partMap.second, 10),
  };
}

/**
 * Format Date to ISO string with timezone offset (e.g. 2026-09-23T00:00:00+08:00)
 */
function formatLocalISOString(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const tempDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  
  // Calculate timezone offset for the given timezone at tempDate
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });
  const tzParts = tzFormatter.formatToParts(tempDate);
  const tzOffsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+08:00';
  let offsetStr = '+08:00';
  const match = tzOffsetPart.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (match) {
    offsetStr = `${match[1]}:${match[2] || '00'}`;
  }

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offsetStr}`;
}

/**
 * Compute report period boundaries [start, end_exclusive) and cutoff (PRD 4.1)
 */
export function computeReportPeriod(
  reportType: AIReportType,
  timezone: string,
  options: {
    isPrevious?: boolean;
    customStartDate?: string; // YYYY-MM-DD
    customEndDate?: string;   // YYYY-MM-DD
    now?: Date;
  } = {}
): ReportPeriod {
  const now = options.now || new Date();
  const nowParts = getDatePartsInTimezone(now, timezone);

  let startYear = nowParts.year;
  let startMonth = nowParts.month;
  let startDay = nowParts.day;

  let endYear = nowParts.year;
  let endMonth = nowParts.month;
  let endDay = nowParts.day;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (reportType === 'weekly') {
    // Current Monday in target timezone
    const daysSinceMonday = nowParts.weekday - 1;
    const mondayDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - daysSinceMonday));
    const mondayParts = getDatePartsInTimezone(mondayDate, timezone);

    if (options.isPrevious) {
      // Last week Monday to this week Monday
      const lastMonday = new Date(Date.UTC(mondayParts.year, mondayParts.month - 1, mondayParts.day - 7));
      const lmParts = getDatePartsInTimezone(lastMonday, timezone);
      startYear = lmParts.year;
      startMonth = lmParts.month;
      startDay = lmParts.day;

      endYear = mondayParts.year;
      endMonth = mondayParts.month;
      endDay = mondayParts.day;
    } else {
      // This week Monday to next week Monday
      startYear = mondayParts.year;
      startMonth = mondayParts.month;
      startDay = mondayParts.day;

      const nextMonday = new Date(Date.UTC(mondayParts.year, mondayParts.month - 1, mondayParts.day + 7));
      const nmParts = getDatePartsInTimezone(nextMonday, timezone);
      endYear = nmParts.year;
      endMonth = nmParts.month;
      endDay = nmParts.day;
    }
  } else if (reportType === 'monthly') {
    if (options.isPrevious) {
      // Last month 1st to this month 1st
      const lastMonthDate = new Date(Date.UTC(nowParts.year, nowParts.month - 2, 1));
      const lmParts = getDatePartsInTimezone(lastMonthDate, timezone);
      startYear = lmParts.year;
      startMonth = lmParts.month;
      startDay = 1;

      endYear = nowParts.year;
      endMonth = nowParts.month;
      endDay = 1;
    } else {
      // This month 1st to next month 1st
      startYear = nowParts.year;
      startMonth = nowParts.month;
      startDay = 1;

      const nextMonthDate = new Date(Date.UTC(nowParts.year, nowParts.month, 1));
      const nmParts = getDatePartsInTimezone(nextMonthDate, timezone);
      endYear = nmParts.year;
      endMonth = nmParts.month;
      endDay = 1;
    }
  } else if (reportType === 'custom') {
    if (options.customStartDate && options.customEndDate) {
      const [sy, sm, sd] = options.customStartDate.split('-').map(Number);
      const [ey, em, ed] = options.customEndDate.split('-').map(Number);
      startYear = sy;
      startMonth = sm;
      startDay = sd;

      // end_exclusive is next day 00:00:00
      const nextDay = new Date(Date.UTC(ey, em - 1, ed + 1));
      const ndParts = getDatePartsInTimezone(nextDay, timezone);
      endYear = ndParts.year;
      endMonth = ndParts.month;
      endDay = ndParts.day;
    }
  }

  const startISO = formatLocalISOString(startYear, startMonth, startDay, 0, 0, 0, timezone);
  const endExclusiveISO = formatLocalISOString(endYear, endMonth, endDay, 0, 0, 0, timezone);

  const startDateObj = new Date(startISO);
  const endExclusiveDateObj = new Date(endExclusiveISO);

  // Cutoff calculation: min(now, end_exclusive)
  let cutoffDateObj = now < endExclusiveDateObj ? now : endExclusiveDateObj;
  // If period has not started yet, cutoff is start
  if (cutoffDateObj < startDateObj) {
    cutoffDateObj = startDateObj;
  }

  const isComplete = now >= endExclusiveDateObj;
  const cutoffParts = getDatePartsInTimezone(cutoffDateObj, timezone);
  const cutoffISO = formatLocalISOString(
    cutoffParts.year,
    cutoffParts.month,
    cutoffParts.day,
    cutoffParts.hour,
    cutoffParts.minute,
    cutoffParts.second,
    timezone
  );

  // Inclusive display end date (1 day before end_exclusive)
  const inclusiveEndDate = new Date(Date.UTC(endYear, endMonth - 1, endDay - 1));
  const incParts = getDatePartsInTimezone(inclusiveEndDate, timezone);
  const displayStart = `${startYear}-${pad(startMonth)}-${pad(startDay)}`;
  const displayEnd = `${incParts.year}-${pad(incParts.month)}-${pad(incParts.day)}`;

  let label = `${displayStart} — ${displayEnd}`;
  if (isComplete) {
    label += ' (完整周期)';
  } else {
    label += `，截至 ${cutoffParts.year}-${pad(cutoffParts.month)}-${pad(cutoffParts.day)} ${pad(
      cutoffParts.hour
    )}:${pad(cutoffParts.minute)}`;
  }

  return {
    start: startISO,
    end_exclusive: endExclusiveISO,
    cutoff: cutoffISO,
    timezone,
    is_complete: isComplete,
    label,
    display_start: displayStart,
    display_end: displayEnd,
  };
}

/**
 * Filter tasks to find valid completed records within [period.start, period.cutoff) (PRD 4.2 & 4.3)
 */
export function filterCompletedRecords(
  tasks: TaskNode[],
  events: TaskEvent[],
  period: ReportPeriod,
  scope: ReportScope,
  options: { sendNotes: boolean; sendOutcomeNotes: boolean; sendBackground?: boolean }
): {
  records: CompletedRecord[];
  stats: { completed_leaf_instances: number; completed_parent_instances: number };
  warnings: string[];
  projectContext: ProjectContextItem[];
  contextNodes: ContextNodeItem[];
} {
  const startTime = new Date(period.start).getTime();
  const cutoffTime = new Date(period.cutoff).getTime();

  const warnings: string[] = [];

  // 1. Build Scope Filter Map
  // Scope contains selected root IDs and all their descendants
  const allowedTaskIds = new Set<string>();
  const isAllScope = scope.root_ids.length === 0;

  if (isAllScope) {
    for (const t of tasks) allowedTaskIds.add(t.id);
  } else {
    const queue = tasks.filter((t) => scope.root_ids.includes(t.id));
    for (const r of queue) allowedTaskIds.add(r.id);

    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tasks) {
        if (!allowedTaskIds.has(t.id) && t.parent_id && allowedTaskIds.has(t.parent_id)) {
          allowedTaskIds.add(t.id);
          changed = true;
        }
      }
    }
  }

  // Remove excluded IDs and all their descendants
  if (scope.excluded_ids.length > 0) {
    const excludedSet = new Set<string>(scope.excluded_ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tasks) {
        if (!excludedSet.has(t.id) && t.parent_id && excludedSet.has(t.parent_id)) {
          excludedSet.add(t.id);
          changed = true;
        }
      }
    }
    for (const id of excludedSet) {
      allowedTaskIds.delete(id);
    }
  }

  // 2. Identify missing completed_at tasks for quality warnings (PRD 3.4 & A10)
  const missingCompletedAtCount = tasks.filter(
    (t) => allowedTaskIds.has(t.id) && t.status === 'done' && !t.completed_at
  ).length;

  if (missingCompletedAtCount > 0) {
    warnings.push(`存在 ${missingCompletedAtCount} 项历史任务缺少明确完成时间，未纳入统计`);
  }

  // 3. Find effective completions within interval
  // A task is included if:
  // - Completed at >= period.start && completed at < period.cutoff
  // - At cutoff, status is done (not uncompleted/deleted)
  // - Is in allowed scope
  const taskMap = new Map<string, TaskNode>(tasks.map((t) => [t.id, t]));

  // Track the most recent status transition before cutoff
  const instanceCompletionMap = new Map<
    string,
    {
      task: TaskNode;
      completionEvent?: TaskEvent;
      completedAt: string;
      isLeaf: boolean;
      outcomeNote: string;
    }
  >();

  // First pass: scan tasks currently marked done with completed_at in range
  for (const t of tasks) {
    if (!allowedTaskIds.has(t.id)) continue;
    if (t.deleted_at && new Date(t.deleted_at).getTime() < cutoffTime) continue;

    if (t.status === 'done' && t.completed_at) {
      const cTime = new Date(t.completed_at).getTime();
      if (cTime >= startTime && cTime < cutoffTime) {
        const instanceId = t.instance_id || t.id;
        const children = tasks.filter((sub) => !sub.deleted_at && sub.parent_id === t.id);
        const isLeaf = children.length === 0;

        instanceCompletionMap.set(instanceId, {
          task: t,
          completedAt: t.completed_at,
          isLeaf,
          outcomeNote: t.outcome_note || '',
        });
      }
    }
  }

  // Second pass: cross-reference task_events to verify historical status at cutoff
  // If an event indicates uncompleted/deleted before cutoff, remove it.
  // If task_events contains snapshot paths, use them!
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const ev of sortedEvents) {
    const evTime = new Date(ev.timestamp).getTime();
    if (evTime >= cutoffTime) break; // Events after cutoff do NOT alter the cutoff state!

    if (!allowedTaskIds.has(ev.task_id)) continue;

    const instanceId = ev.instance_id || ev.task_id;

    if (ev.event_type === 'task_uncompleted') {
      instanceCompletionMap.delete(instanceId);
    } else if (ev.event_type === 'task_completed') {
      if (evTime >= startTime && evTime < cutoffTime) {
        const liveTask = taskMap.get(ev.task_id);
        if (liveTask && (!liveTask.deleted_at || new Date(liveTask.deleted_at).getTime() >= cutoffTime)) {
          instanceCompletionMap.set(instanceId, {
            task: liveTask,
            completionEvent: ev,
            completedAt: ev.timestamp,
            isLeaf: ev.is_leaf_at_completion ?? (tasks.filter((s) => s.parent_id === liveTask.id).length === 0),
            outcomeNote: ev.outcome_note || liveTask.outcome_note || '',
          });
        }
      }
    }
  }

  // Build completed_records list
  const records: CompletedRecord[] = [];
  let completedLeafCount = 0;
  let completedParentCount = 0;

  const relevantAncestorIds = new Set<string>();

  for (const [instanceId, info] of instanceCompletionMap.entries()) {
    const { task, completionEvent, completedAt, isLeaf, outcomeNote } = info;

    let pathIds: string[] = [];
    let pathTitles: string[] = [];

    if (completionEvent && completionEvent.path_ids_at_completion) {
      pathIds = completionEvent.path_ids_at_completion;
      pathTitles = completionEvent.path_titles_at_completion || [];
    } else {
      const ancestors = getAncestorNodes(tasks, task);
      pathIds = ancestors.map((a) => a.id);
      pathTitles = ancestors.map((a) => a.title);
    }

    for (const pid of pathIds) relevantAncestorIds.add(pid);

    if (isLeaf) completedLeafCount++;
    else completedParentCount++;

    const record: CompletedRecord = {
      task_id: task.id,
      instance_id: instanceId,
      title: task.title,
      path_ids_at_completion: pathIds,
      path_titles_at_completion: pathTitles,
      completed_at: completedAt,
      is_leaf_at_completion: isLeaf,
      outcome_note: options.sendOutcomeNotes ? outcomeNote : '',
      recurrence_rule_id: task.recurrence_rule_id || null,
      occurrence_key: task.recurrence_period_key || null,
    };

    if (options.sendNotes && task.note) {
      record.note = task.note;
    }

    records.push(record);
  }

  // 4. Build project_context and context_nodes (PRD 4.3, 5 & PRD v1.2 A32)
  const projectContext: ProjectContextItem[] = [];
  const contextNodes: ContextNodeItem[] = [];
  const visitedContextNodeIds = new Set<string>();

  for (const ancId of relevantAncestorIds) {
    const ancTask = taskMap.get(ancId);
    if (ancTask) {
      const ancestors = getAncestorNodes(tasks, ancTask);
      const pathIds = [...ancestors.map((a) => a.id), ancTask.id];
      const pathTitles = [...ancestors.map((a) => a.title), ancTask.title];

      projectContext.push({
        id: ancTask.id,
        path_ids: pathIds,
        path_titles: pathTitles,
        status_at_cutoff: ancTask.status,
      });

      if (!visitedContextNodeIds.has(ancTask.id)) {
        visitedContextNodeIds.add(ancTask.id);
        contextNodes.push({
          node_id: ancTask.id,
          parent_id: ancTask.parent_id,
          path_ids: pathIds,
          path_titles: pathTitles,
          title: ancTask.title,
          background_text:
            options.sendBackground !== false && ancTask.background_text
              ? ancTask.background_text
              : undefined,
          note: options.sendNotes && ancTask.note ? ancTask.note : undefined,
          status_at_cutoff: ancTask.status,
          updated_at: ancTask.updated_at,
        });
      }
    }
  }

  // Also include completed tasks in context_nodes if they have background_text
  for (const r of records) {
    if (!visitedContextNodeIds.has(r.task_id)) {
      const t = taskMap.get(r.task_id);
      if (t && (t.background_text || (options.sendNotes && t.note))) {
        visitedContextNodeIds.add(t.id);
        const ancestors = getAncestorNodes(tasks, t);
        contextNodes.push({
          node_id: t.id,
          parent_id: t.parent_id,
          path_ids: [...ancestors.map((a) => a.id), t.id],
          path_titles: [...ancestors.map((a) => a.title), t.title],
          title: t.title,
          background_text:
            options.sendBackground !== false && t.background_text
              ? t.background_text
              : undefined,
          note: options.sendNotes && t.note ? t.note : undefined,
          status_at_cutoff: t.status,
          updated_at: t.updated_at,
        });
      }
    }
  }

  return {
    records,
    stats: {
      completed_leaf_instances: completedLeafCount,
      completed_parent_instances: completedParentCount,
    },
    warnings,
    projectContext,
    contextNodes,
  };
}

/**
 * Build the full immutable FactsPackage data contract (PRD Section 5 & PRD v1.2 A32)
 */
export function buildFactsPackage(
  reportType: AIReportType,
  tasks: TaskNode[],
  events: TaskEvent[],
  scope: ReportScope,
  timezone: string,
  options: {
    isPrevious?: boolean;
    customStartDate?: string;
    customEndDate?: string;
    sendNotes: boolean;
    sendOutcomeNotes: boolean;
    sendBackground?: boolean;
    now?: Date;
  }
): FactsPackage {
  const period = computeReportPeriod(reportType, timezone, {
    isPrevious: options.isPrevious,
    customStartDate: options.customStartDate,
    customEndDate: options.customEndDate,
    now: options.now,
  });

  const { records, stats, warnings, projectContext, contextNodes } = filterCompletedRecords(
    tasks,
    events,
    period,
    scope,
    {
      sendNotes: options.sendNotes,
      sendOutcomeNotes: options.sendOutcomeNotes,
      sendBackground: options.sendBackground !== false,
    }
  );

  return {
    report_type: reportType,
    period,
    scope,
    data_quality: {
      history_complete: warnings.length === 0,
      warnings,
    },
    stats,
    project_context: projectContext,
    completed_records: records,
    context_nodes: contextNodes,
  };
}
