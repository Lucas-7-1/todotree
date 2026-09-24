import React, { useState, useMemo } from 'react';
import { TaskNode } from '../../types/todo';
import {
  isTaskOverdue,
  isTaskDueToday,
  getAncestorPath,
  formatRelativeDate,
} from '../../services/treeOperations';
import { getTodayDateString } from '../../services/seedData';
import { formatDateInTimezone } from '../../services/calendarService';
import { CompletionCalendar } from './CompletionCalendar';
import {
  Calendar,
  AlertCircle,
  Clock,
  Check,
  ChevronDown,
  ChevronRight,
  Inbox,
  Sparkles,
  ArrowRight,
  ListTodo,
} from 'lucide-react';

interface TodayViewProps {
  tasks: TaskNode[];
  timezone?: string;
  onToggleComplete: (task: TaskNode) => void;
  onSelectTask: (task: TaskNode) => void;
  onNavigateToTree: (taskId: string) => void;
  onUpdateTask: (id: string, updates: Partial<TaskNode>) => void;
  onOpenCompletedDrawer?: () => void;
  initialTab?: 'execution' | 'calendar';
}

export const TodayView: React.FC<TodayViewProps> = ({
  tasks,
  timezone = 'Asia/Shanghai',
  onToggleComplete,
  onSelectTask,
  onNavigateToTree,
  onUpdateTask,
  onOpenCompletedDrawer,
  initialTab = 'execution',
}) => {
  const [activeTab, setActiveTab] = useState<'execution' | 'calendar'>(initialTab);
  const [showPreviousPlanned, setShowPreviousPlanned] = useState(false);

  const todayStr = useMemo(
    () => formatDateInTimezone(new Date(), timezone),
    [timezone]
  );

  // Active open tasks only
  const activeTasks = useMemo(
    () => tasks.filter((t) => !t.deleted_at && t.status === 'open'),
    [tasks]
  );

  // Today completed tasks (for summary & achievements preview)
  const todayCompletedTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.deleted_at || t.status !== 'done' || !t.completed_at) return false;
      const compDate = formatDateInTimezone(new Date(t.completed_at), timezone);
      return compDate === todayStr;
    });
  }, [tasks, timezone, todayStr]);

  // Groups
  const overdueList: TaskNode[] = [];
  const dueTodayList: TaskNode[] = [];
  const plannedTodayList: TaskNode[] = [];
  const previousPlannedList: TaskNode[] = [];

  const assignedIds = new Set<string>();

  // 1. Overdue
  for (const t of activeTasks) {
    if (isTaskOverdue(t)) {
      overdueList.push(t);
      assignedIds.add(t.id);
    }
  }

  // 2. Due today
  for (const t of activeTasks) {
    if (!assignedIds.has(t.id) && isTaskDueToday(t)) {
      dueTodayList.push(t);
      assignedIds.add(t.id);
    }
  }

  // 3. Planned today (planned_date === today)
  for (const t of activeTasks) {
    if (!assignedIds.has(t.id) && t.planned_date === todayStr) {
      plannedTodayList.push(t);
      assignedIds.add(t.id);
    }
  }

  // 4. Previously planned unfinished (planned_date < today)
  for (const t of activeTasks) {
    if (!assignedIds.has(t.id) && t.planned_date && t.planned_date < todayStr) {
      previousPlannedList.push(t);
      assignedIds.add(t.id);
    }
  }

  const totalTodayTasks = overdueList.length + dueTodayList.length + plannedTodayList.length;

  const handleRemoveFromToday = (task: TaskNode) => {
    onUpdateTask(task.id, { planned_date: null });
  };

  const handleReAddToday = (task: TaskNode) => {
    onUpdateTask(task.id, { planned_date: todayStr });
  };

  // Compact row renderer (PRD 2.5: 任务用紧凑行展示，不为每一条任务套巨型卡片)
  const renderCompactTaskRow = (
    task: TaskNode,
    badgeType: 'overdue' | 'dueToday' | 'planned' | 'prev'
  ) => {
    const ancestors = getAncestorPath(tasks, task);
    const dateInfo = formatRelativeDate(task);

    return (
      <div
        key={task.id}
        onClick={() => onSelectTask(task)}
        className="group bg-white hover:bg-slate-50/80 rounded-lg px-3 py-2 border border-slate-200/80 transition-colors flex items-center justify-between gap-3 cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {/* Checkbox */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(task);
            }}
            className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border border-slate-300 hover:border-blue-500 bg-white transition-colors"
          >
            {task.status === 'done' && <Check className="w-3 h-3 text-blue-600 stroke-[3]" />}
          </button>

          {/* Title */}
          <div className="font-medium text-xs text-slate-800 truncate flex-1 min-w-0">
            {task.title}
          </div>

          {/* Ancestor path */}
          {ancestors.length > 0 && (
            <div className="text-[11px] text-slate-400 truncate max-w-[160px] hidden md:block">
              {ancestors.join(' / ')}
            </div>
          )}
        </div>

        {/* Badges and Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {badgeType === 'overdue' && (
            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200/80 px-1.5 py-0.5 rounded">
              逾期 {dateInfo.label}
            </span>
          )}

          {badgeType === 'dueToday' && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 px-1.5 py-0.5 rounded">
              今日截止
            </span>
          )}

          {badgeType === 'planned' && (
            <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 rounded">
              今日安排
            </span>
          )}

          {badgeType === 'prev' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReAddToday(task);
              }}
              className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded transition-colors"
            >
              移入今天
            </button>
          )}

          {badgeType === 'planned' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveFromToday(task);
              }}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-red-600 px-1 transition-opacity"
              title="移出今天安排"
            >
              移出
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
      {/* 1. Header Toolbar with Unified Tabs */}
      <div className="px-6 pt-3 border-b border-slate-200/80 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setActiveTab('execution')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'execution'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ListTodo className="w-4 h-4" />
            <span>今日执行</span>
            {totalTodayTasks > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 bg-blue-50 text-blue-600 rounded-full font-semibold">
                {totalTodayTasks}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'calendar'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>完成日历</span>
          </button>
        </div>

        {/* Right drawer entry */}
        {onOpenCompletedDrawer && (
          <button
            onClick={onOpenCompletedDrawer}
            className="mb-2 flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors border border-slate-200/60"
            title="查看已完成历史抽屉"
          >
            <Check className="w-3.5 h-3.5 text-blue-600" />
            <span>已完成面板</span>
          </button>
        )}
      </div>

      {/* 2. Content Views */}
      {activeTab === 'calendar' ? (
        <CompletionCalendar
          tasks={tasks}
          timezone={timezone}
          onSelectTask={onSelectTask}
          onNavigateToTree={onNavigateToTree}
        />
      ) : (
        /* Tab 1: 今日执行 */
        <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full mx-auto space-y-5">
          {/* Top Compact Summary Bar (PRD 2.5: 待处理 N · 已完成 N · 已逾期 N) */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs shadow-2xs">
            <div className="flex items-center gap-4 text-slate-600 font-medium">
              <div>
                <span>待处理 </span>
                <strong className="text-slate-900 font-bold">{totalTodayTasks}</strong>
              </div>
              <span className="text-slate-300">·</span>
              <button
                onClick={() => setActiveTab('calendar')}
                className="hover:text-blue-600 hover:underline flex items-center gap-1"
                title="点击切换到完成日历查看详情"
              >
                <span>已完成 </span>
                <strong className="text-emerald-600 font-bold">{todayCompletedTasks.length}</strong>
              </button>
              <span className="text-slate-300">·</span>
              <div>
                <span>已逾期 </span>
                <strong
                  className={`font-bold ${
                    overdueList.length > 0 ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  {overdueList.length}
                </strong>
              </div>
            </div>

            {todayCompletedTasks.length > 0 && (
              <button
                onClick={() => setActiveTab('calendar')}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 transition-colors"
              >
                <span>查看今日成果</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Task Lists or Empty States */}
          {totalTodayTasks === 0 ? (
            todayCompletedTasks.length > 0 ? (
              /* PRD 2.5: 无待办但有今日完成时，用明确完成反馈和最多 3 条今日成果预览替代纯空图标 */
              <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl p-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <Sparkles className="w-6 h-6 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    太棒了！今日安排的任务已全部处理完毕
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    今天已高效完成 {todayCompletedTasks.length} 项工作，继续保持！
                  </p>
                </div>

                {/* Up to 3 previews */}
                <div className="max-w-md mx-auto space-y-1.5 text-left pt-1">
                  {todayCompletedTasks.slice(0, 3).map((t) => (
                    <div
                      key={t.id}
                      className="bg-white rounded-lg p-2 border border-emerald-100 flex items-center gap-2 text-xs"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                      <span className="text-slate-700 font-medium truncate flex-1">{t.title}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setActiveTab('calendar')}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
                >
                  查看全部完成记录 / 完成日历
                </button>
              </div>
            ) : (
              /* Clean normal empty state */
              <div className="py-16 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                  <Inbox className="w-6 h-6" />
                </div>
                <p className="text-xs font-semibold text-slate-700">今天没有需要处理的待办任务</p>
                <p className="text-[11px] text-slate-400">
                  可以从「全部任务」树中主动将任务「加入今天」进行聚焦
                </p>
              </div>
            )
          ) : (
            /* Non-empty task groups */
            <div className="space-y-5">
              {/* Overdue Section */}
              {overdueList.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>已逾期 ({overdueList.length})</span>
                  </div>
                  <div className="space-y-1">
                    {overdueList.map((t) => renderCompactTaskRow(t, 'overdue'))}
                  </div>
                </div>
              )}

              {/* Due Today Section */}
              {dueTodayList.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                    <Clock className="w-3.5 h-3.5" />
                    <span>今日截止 ({dueTodayList.length})</span>
                  </div>
                  <div className="space-y-1">
                    {dueTodayList.map((t) => renderCompactTaskRow(t, 'dueToday'))}
                  </div>
                </div>
              )}

              {/* Planned Today Section */}
              {plannedTodayList.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>今日主动安排 ({plannedTodayList.length})</span>
                  </div>
                  <div className="space-y-1">
                    {plannedTodayList.map((t) => renderCompactTaskRow(t, 'planned'))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Previously Planned Unfinished Section */}
          {previousPlannedList.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={() => setShowPreviousPlanned(!showPreviousPlanned)}
                className="flex items-center justify-between w-full py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                <span>此前安排未完成 ({previousPlannedList.length})</span>
                {showPreviousPlanned ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {showPreviousPlanned && (
                <div className="space-y-1 mt-2">
                  {previousPlannedList.map((t) => renderCompactTaskRow(t, 'prev'))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
