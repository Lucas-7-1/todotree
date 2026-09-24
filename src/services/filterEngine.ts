import { TaskNode, QuadrantType } from '../types/todo';
import { getAncestorNodes, getDescendantTasks } from './treeOperations';

export interface TimeFilterConfig {
  field: 'due_date' | 'planned_date' | 'created_at' | 'updated_at';
  preset: 'all' | 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_7_days' | 'unset' | 'custom';
  customStart?: string; // YYYY-MM-DD
  customEnd?: string;   // YYYY-MM-DD
}

export interface TaskFilterState {
  keywords: string;
  searchInFields: {
    titleAndPath: boolean;
    background: boolean;
    note: boolean;
    outcome: boolean;
  };
  importance: 'all' | 'important' | 'unimportant' | 'unclassified';
  urgency: 'all' | 'urgent' | 'not_urgent';
  quadrants: QuadrantType[]; // Array of selected quadrants, null represents '未分类'
  timeFilter: TimeFilterConfig;
  projectScope: {
    rootId: string | null;
    includeDescendants: boolean;
  };
  taskType: 'all' | 'normal' | 'recurring';
}

export type GroupOption = 'none' | 'project' | 'quadrant' | 'due_date';
export type SortOption = 'manual' | 'due_date' | 'priority' | 'created_at' | 'updated_at' | 'title';
export type SortDirection = 'asc' | 'desc';

export const DEFAULT_FILTER_STATE: TaskFilterState = {
  keywords: '',
  searchInFields: {
    titleAndPath: true,
    background: false,
    note: false,
    outcome: false,
  },
  importance: 'all',
  urgency: 'all',
  quadrants: [],
  timeFilter: {
    field: 'due_date',
    preset: 'all',
  },
  projectScope: {
    rootId: null,
    includeDescendants: true,
  },
  taskType: 'all',
};

// Check if any filter is active
export function isFilterActive(state: TaskFilterState): boolean {
  if (state.keywords.trim().length > 0) return true;
  if (state.importance !== 'all') return true;
  if (state.urgency !== 'all') return true;
  if (state.quadrants.length > 0) return true;
  if (state.timeFilter.preset !== 'all') return true;
  if (state.projectScope.rootId !== null) return true;
  if (state.taskType !== 'all') return true;
  return false;
}

// Format local date YYYY-MM-DD
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get Monday and Sunday of current week (Monday=1, Sunday=7)
export function getThisWeekRange(today: Date = new Date()): { startStr: string; endStr: string } {
  const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday...
  const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  
  const monday = new Date(today);
  monday.setDate(today.getDate() + distanceToMonday);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startStr: getLocalDateString(monday),
    endStr: getLocalDateString(sunday),
  };
}

export interface MatchSnippet {
  field: 'background' | 'note' | 'outcome';
  text: string;
}

export interface FilterResult {
  matchedTasks: TaskNode[];
  taskSnippets: Map<string, MatchSnippet>;
  matchedIds: Set<string>;
  contextAncestorIds: Set<string>;
}

// Match single task against all filter criteria
export function matchTask(
  task: TaskNode,
  allTasks: TaskNode[],
  filter: TaskFilterState,
  todayStr: string = getLocalDateString(),
  now: Date = new Date(),
  taskMap?: Map<string, TaskNode>
): { matched: boolean; snippet?: MatchSnippet } {
  // Only active uncompleted, non-deleted tasks
  if (task.deleted_at || task.status === 'done') {
    return { matched: false };
  }

  // 1. Keyword search
  const query = filter.keywords.trim().toLowerCase();
  let snippet: MatchSnippet | undefined;
  if (query.length > 0) {
    const terms = query.split(/\s+/).filter(t => t.length > 0);
    const titleLower = task.title.toLowerCase();
    let lazyPathStr: string | null = null;

    const getPathStr = (): string => {
      if (lazyPathStr !== null) return lazyPathStr;
      let path = '';
      let cur = task;
      while (cur && cur.parent_id) {
        const p = taskMap ? taskMap.get(cur.parent_id) : allTasks.find(t => t.id === cur.parent_id);
        if (!p) break;
        path = p.title + (path ? ' / ' + path : '');
        cur = p;
      }
      lazyPathStr = path.toLowerCase();
      return lazyPathStr;
    };

    // Check terms
    for (const term of terms) {
      let termMatched = false;

      if (filter.searchInFields.titleAndPath) {
        if (titleLower.includes(term)) {
          termMatched = true;
        } else if (getPathStr().includes(term)) {
          termMatched = true;
        }
      }

      if (!termMatched && filter.searchInFields.note && task.note) {
        const noteLower = task.note.toLowerCase();
        const idx = noteLower.indexOf(term);
        if (idx !== -1) {
          termMatched = true;
          if (!snippet) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(task.note.length, idx + term.length + 25);
            snippet = { field: 'note', text: (start > 0 ? '...' : '') + task.note.slice(start, end).trim() + (end < task.note.length ? '...' : '') };
          }
        }
      }

      if (!termMatched && filter.searchInFields.background && task.background_text) {
        const bgLower = task.background_text.toLowerCase();
        const idx = bgLower.indexOf(term);
        if (idx !== -1) {
          termMatched = true;
          if (!snippet) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(task.background_text.length, idx + term.length + 25);
            snippet = { field: 'background', text: (start > 0 ? '...' : '') + task.background_text.slice(start, end).trim() + (end < task.background_text.length ? '...' : '') };
          }
        }
      }

      if (!termMatched && filter.searchInFields.outcome && task.outcome_note) {
        const outLower = task.outcome_note.toLowerCase();
        const idx = outLower.indexOf(term);
        if (idx !== -1) {
          termMatched = true;
          if (!snippet) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(task.outcome_note.length, idx + term.length + 25);
            snippet = { field: 'outcome', text: (start > 0 ? '...' : '') + task.outcome_note.slice(start, end).trim() + (end < task.outcome_note.length ? '...' : '') };
          }
        }
      }

      if (!termMatched) {
        return { matched: false };
      }
    }
  }

  // 2. Importance
  if (filter.importance !== 'all') {
    if (filter.importance === 'important') {
      if (task.quadrant !== 'Q1' && task.quadrant !== 'Q2') return { matched: false };
    } else if (filter.importance === 'unimportant') {
      if (task.quadrant !== 'Q3' && task.quadrant !== 'Q4') return { matched: false };
    } else if (filter.importance === 'unclassified') {
      if (task.quadrant !== null) return { matched: false };
    }
  }

  // 3. Urgency
  if (filter.urgency !== 'all') {
    if (filter.urgency === 'urgent') {
      if (task.quadrant !== 'Q1' && task.quadrant !== 'Q3') return { matched: false };
    } else if (filter.urgency === 'not_urgent') {
      if (task.quadrant !== 'Q2' && task.quadrant !== 'Q4') return { matched: false };
    }
  }

  // 4. Quadrant multi-select (OR within same dimension)
  if (filter.quadrants.length > 0) {
    const hasMatch = filter.quadrants.some(q => q === task.quadrant);
    if (!hasMatch) return { matched: false };
  }

  // 5. Time boundary
  if (filter.timeFilter.preset !== 'all') {
    const field = filter.timeFilter.field;
    const preset = filter.timeFilter.preset;

    if (field === 'due_date') {
      const hasDate = !!(task.due_date || task.due_at);
      if (preset === 'unset') {
        if (hasDate) return { matched: false };
      } else {
        if (!hasDate) return { matched: false };

        const targetDate = task.due_date;
        const targetDateTime = task.due_at ? new Date(task.due_at) : null;

        if (preset === 'overdue') {
          // Overdue calculation (PRD 1.3):
          // If datetime: after target datetime
          // If date-only: overdue starting next day 00:00 (targetDate < todayStr)
          if (targetDateTime) {
            if (targetDateTime >= now) return { matched: false };
          } else if (targetDate) {
            if (targetDate >= todayStr) return { matched: false };
          }
        } else if (preset === 'today') {
          if (targetDate !== todayStr) return { matched: false };
        } else if (preset === 'tomorrow') {
          const tom = new Date(now);
          tom.setDate(tom.getDate() + 1);
          const tomStr = getLocalDateString(tom);
          if (targetDate !== tomStr) return { matched: false };
        } else if (preset === 'this_week') {
          const { startStr, endStr } = getThisWeekRange(now);
          if (!targetDate || targetDate < startStr || targetDate > endStr) return { matched: false };
        } else if (preset === 'next_7_days') {
          const end7 = new Date(now);
          end7.setDate(end7.getDate() + 6);
          const end7Str = getLocalDateString(end7);
          if (!targetDate || targetDate < todayStr || targetDate > end7Str) return { matched: false };
        } else if (preset === 'custom') {
          const cStart = filter.timeFilter.customStart;
          const cEnd = filter.timeFilter.customEnd;
          if (cStart && (!targetDate || targetDate < cStart)) return { matched: false };
          if (cEnd && (!targetDate || targetDate > cEnd)) return { matched: false };
        }
      }
    } else if (field === 'planned_date') {
      const pDate = task.planned_date;
      if (preset === 'unset') {
        if (pDate) return { matched: false };
      } else if (preset === 'today') {
        if (pDate !== todayStr) return { matched: false };
      } else if (preset === 'tomorrow') {
        const tom = new Date(now);
        tom.setDate(tom.getDate() + 1);
        if (pDate !== getLocalDateString(tom)) return { matched: false };
      } else if (preset === 'this_week') {
        const { startStr, endStr } = getThisWeekRange(now);
        if (!pDate || pDate < startStr || pDate > endStr) return { matched: false };
      } else if (preset === 'next_7_days') {
        const end7 = new Date(now);
        end7.setDate(end7.getDate() + 6);
        const end7Str = getLocalDateString(end7);
        if (!pDate || pDate < todayStr || pDate > end7Str) return { matched: false };
      } else if (preset === 'custom') {
        const cStart = filter.timeFilter.customStart;
        const cEnd = filter.timeFilter.customEnd;
        if (cStart && (!pDate || pDate < cStart)) return { matched: false };
        if (cEnd && (!pDate || pDate > cEnd)) return { matched: false };
      }
    } else if (field === 'created_at' || field === 'updated_at') {
      const rawIso = field === 'created_at' ? task.created_at : task.updated_at;
      if (!rawIso) return { matched: false };
      const itemDateStr = getLocalDateString(new Date(rawIso));

      if (preset === 'today') {
        if (itemDateStr !== todayStr) return { matched: false };
      } else if (preset === 'this_week') {
        const { startStr, endStr } = getThisWeekRange(now);
        if (itemDateStr < startStr || itemDateStr > endStr) return { matched: false };
      } else if (preset === 'custom') {
        const cStart = filter.timeFilter.customStart;
        const cEnd = filter.timeFilter.customEnd;
        if (cStart && itemDateStr < cStart) return { matched: false };
        if (cEnd && itemDateStr > cEnd) return { matched: false };
      }
    }
  }

  // 6. Project Scope
  if (filter.projectScope.rootId !== null) {
    if (filter.projectScope.includeDescendants) {
      if (task.id !== filter.projectScope.rootId) {
        const ancestors = getAncestorNodes(allTasks, task);
        if (!ancestors.some(a => a.id === filter.projectScope.rootId)) {
          return { matched: false };
        }
      }
    } else {
      if (task.id !== filter.projectScope.rootId) {
        return { matched: false };
      }
    }
  }

  // 7. Task Type
  if (filter.taskType !== 'all') {
    const isRecurring = !!(task.recurrence_rule_id || task.instance_id || (task.recurrence_rule && task.recurrence_rule.type !== 'none'));
    if (filter.taskType === 'recurring' && !isRecurring) return { matched: false };
    if (filter.taskType === 'normal' && isRecurring) return { matched: false };
  }

  return { matched: true, snippet };
}

// Apply filter across tasks
export function applyTaskFilters(
  tasks: TaskNode[],
  filter: TaskFilterState,
  todayStr: string = getLocalDateString(),
  now: Date = new Date()
): FilterResult {
  const taskMap = new Map<string, TaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const matchedTasks: TaskNode[] = [];
  const taskSnippets = new Map<string, MatchSnippet>();
  const matchedIds = new Set<string>();
  const contextAncestorIds = new Set<string>();

  for (const t of tasks) {
    const result = matchTask(t, tasks, filter, todayStr, now, taskMap);
    if (result.matched) {
      matchedTasks.push(t);
      matchedIds.add(t.id);
      if (result.snippet) {
        taskSnippets.set(t.id, result.snippet);
      }
      // Collect necessary ancestors for tree context
      let cur = t;
      while (cur && cur.parent_id) {
        const a = taskMap.get(cur.parent_id);
        if (!a) break;
        if (!a.deleted_at && a.status === 'open') {
          contextAncestorIds.add(a.id);
        }
        cur = a;
      }
    }
  }

  return {
    matchedTasks,
    taskSnippets,
    matchedIds,
    contextAncestorIds,
  };
}

// Stable sorting helper
export function sortTasks(
  tasks: TaskNode[],
  option: SortOption,
  direction: SortDirection = 'asc',
  todayStr: string = getLocalDateString()
): TaskNode[] {
  if (option === 'manual') {
    return [...tasks].sort((a, b) => a.sort_order - b.sort_order);
  }

  const priorityWeight: Record<string, number> = {
    Q1: 1,
    Q2: 2,
    Q3: 3,
    Q4: 4,
  };

  return [...tasks].sort((a, b) => {
    let diff = 0;

    if (option === 'due_date') {
      const aDate = a.due_date || (a.due_at ? a.due_at.slice(0, 10) : null);
      const bDate = b.due_date || (b.due_at ? b.due_at.slice(0, 10) : null);

      // Tasks with NO due date are ALWAYS placed AFTER tasks with due date
      if (!aDate && bDate) return 1;
      if (aDate && !bDate) return -1;
      if (!aDate && !bDate) diff = 0;
      else if (aDate && bDate) diff = aDate.localeCompare(bDate);
    } else if (option === 'priority') {
      const aW = a.quadrant ? priorityWeight[a.quadrant] : 99; // unclassified is 99
      const bW = b.quadrant ? priorityWeight[b.quadrant] : 99;
      diff = aW - bW;
    } else if (option === 'created_at') {
      diff = a.created_at.localeCompare(b.created_at);
    } else if (option === 'updated_at') {
      diff = a.updated_at.localeCompare(b.updated_at);
    } else if (option === 'title') {
      diff = a.title.localeCompare(b.title, 'zh-Hans-CN');
    }

    if (diff !== 0) {
      return direction === 'desc' ? -diff : diff;
    }

    // Stable tie-breaker: sort_order then id
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id.localeCompare(b.id);
  });
}

// Grouping structure
export interface TaskGroup {
  id: string;
  title: string;
  tasks: TaskNode[];
  count: number;
}

export function groupTasks(
  tasks: TaskNode[],
  allTasks: TaskNode[],
  groupOption: GroupOption,
  todayStr: string = getLocalDateString(),
  now: Date = new Date()
): TaskGroup[] {
  if (groupOption === 'none') {
    return [{ id: 'all', title: '全部任务', tasks, count: tasks.length }];
  }

  if (groupOption === 'project') {
    const rootNodes = allTasks.filter(t => !t.parent_id && !t.deleted_at);
    const groups: TaskGroup[] = [];

    for (const root of rootNodes) {
      const groupTasksList = tasks.filter(t => {
        if (t.id === root.id) return true;
        const ancestors = getAncestorNodes(allTasks, t);
        return ancestors.some(a => a.id === root.id);
      });

      if (groupTasksList.length > 0) {
        groups.push({
          id: root.id,
          title: root.title,
          tasks: groupTasksList,
          count: groupTasksList.length,
        });
      }
    }

    // Include tasks that have no root ancestor matching
    const assignedIds = new Set(groups.flatMap(g => g.tasks.map(t => t.id)));
    const unassigned = tasks.filter(t => !assignedIds.has(t.id));
    if (unassigned.length > 0) {
      groups.push({
        id: 'other',
        title: '其他待归类',
        tasks: unassigned,
        count: unassigned.length,
      });
    }

    return groups;
  }

  if (groupOption === 'quadrant') {
    const qLabels: Record<string, string> = {
      Q1: '重要且紧急 (Q1)',
      Q2: '重要不紧急 (Q2)',
      Q3: '紧急不重要 (Q3)',
      Q4: '不重要不紧急 (Q4)',
      unclassified: '未分类',
    };

    const buckets: Record<string, TaskNode[]> = {
      Q1: [],
      Q2: [],
      Q3: [],
      Q4: [],
      unclassified: [],
    };

    for (const t of tasks) {
      if (t.quadrant && buckets[t.quadrant]) {
        buckets[t.quadrant].push(t);
      } else {
        buckets['unclassified'].push(t);
      }
    }

    const groups: TaskGroup[] = [];
    for (const key of ['Q1', 'Q2', 'Q3', 'Q4', 'unclassified']) {
      groups.push({
        id: key,
        title: qLabels[key],
        tasks: buckets[key],
        count: buckets[key].length,
      });
    }
    return groups;
  }

  if (groupOption === 'due_date') {
    const tom = new Date(now);
    tom.setDate(tom.getDate() + 1);
    const tomStr = getLocalDateString(tom);

    const buckets: Record<string, TaskNode[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      later: [],
      unset: [],
    };

    for (const t of tasks) {
      const dDate = t.due_date;
      const dDateTime = t.due_at ? new Date(t.due_at) : null;

      if (!dDate && !dDateTime) {
        buckets.unset.push(t);
      } else {
        let isOverdue = false;
        if (dDateTime) isOverdue = dDateTime < now;
        else if (dDate) isOverdue = dDate < todayStr;

        if (isOverdue) {
          buckets.overdue.push(t);
        } else if (dDate === todayStr) {
          buckets.today.push(t);
        } else if (dDate === tomStr) {
          buckets.tomorrow.push(t);
        } else {
          buckets.later.push(t);
        }
      }
    }

    return [
      { id: 'overdue', title: '已逾期', tasks: buckets.overdue, count: buckets.overdue.length },
      { id: 'today', title: '今天', tasks: buckets.today, count: buckets.today.length },
      { id: 'tomorrow', title: '明天', tasks: buckets.tomorrow, count: buckets.tomorrow.length },
      { id: 'later', title: '之后', tasks: buckets.later, count: buckets.later.length },
      { id: 'unset', title: '未设置', tasks: buckets.unset, count: buckets.unset.length },
    ];
  }

  return [];
}
