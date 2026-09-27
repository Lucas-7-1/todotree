import React, { useState, useEffect, useMemo } from 'react';
import { TaskNode } from '../../types/todo';
import { TaskEvent } from '../../types/ai';
import { loadEventsFromStorage } from '../../services/ai/eventLogger';
import {
  generateMonthGrid,
  aggregateMonthEvents,
  getDayCompletionDetail,
  formatDateInTimezone,
  CalendarDayCell,
  CalendarDayDetail,
} from '../../services/calendarService';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Folder,
  Clock,
  RotateCcw,
  Sparkles,
  Inbox,
  Filter,
} from 'lucide-react';

interface CompletionCalendarProps {
  tasks: TaskNode[];
  timezone: string;
  onSelectTask?: (task: TaskNode) => void;
  onNavigateToTree?: (taskId: string) => void;
}

export const CompletionCalendar: React.FC<CompletionCalendarProps> = ({
  tasks,
  timezone,
  onSelectTask,
  onNavigateToTree,
}) => {
  const todayStr = useMemo(() => formatDateInTimezone(new Date(), timezone), [timezone]);
  const todayDate = useMemo(() => new Date(), []);

  // Calendar view navigation state
  const [currentYear, setCurrentYear] = useState<number>(todayDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(todayDate.getMonth() + 1); // 1-12
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);
  const [projectFilter, setProjectFilter] = useState<string>('all');

  // Loaded raw events
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const reload = () => { void loadEventsFromStorage().then(data => { if (mounted) { setEvents(data); setIsLoading(false); } }).catch(() => { if (mounted) setIsLoading(false); }); };
    reload(); window.addEventListener('todotree:persisted', reload);
    return () => { mounted = false; window.removeEventListener('todotree:persisted', reload); };
  }, []);

  // Root projects for filter
  const rootProjects = useMemo(() => {
    return tasks.filter((t) => !t.deleted_at && t.parent_id === null);
  }, [tasks]);

  // Navigate months
  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
    setSelectedDateStr(todayStr);
  };

  // Generate 42-day grid and aggregate events
  const gridCells = useMemo(() => {
    const rawCells = generateMonthGrid(currentYear, currentMonth, todayStr);
    return aggregateMonthEvents(events, rawCells, timezone, tasks, projectFilter);
  }, [currentYear, currentMonth, todayStr, events, timezone, tasks, projectFilter]);

  // Get selected day detail
  const dayDetail: CalendarDayDetail = useMemo(() => {
    return getDayCompletionDetail(events, selectedDateStr, timezone, tasks, projectFilter);
  }, [events, selectedDateStr, timezone, tasks, projectFilter]);

  // Weekday headers
  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div className="completion-calendar flex-1 flex flex-col min-h-0 bg-white overflow-hidden select-none">
      {/* 1. Calendar Header & Controls */}
      <div className="py-3 px-6 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-3 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200/60">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded-md hover:bg-white text-slate-600 hover:text-slate-900 transition-colors"
              title="上一月"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 text-xs font-bold text-slate-800">
              {currentYear}年 {currentMonth}月
            </div>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded-md hover:bg-white text-slate-600 hover:text-slate-900 transition-colors"
              title="下一月"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleGoToToday}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            回到今天
          </button>
        </div>

        {/* Project Filter Selector */}
        <div className="calendar-project-filter flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>项目:</span>
          </span>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 outline-none focus:border-blue-500 font-medium"
          >
            <option value="all">全部大类</option>
            {rootProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 2. Main Content Split: Left Month Calendar (~60%), Right Day Details (~40%) */}
      <div className="calendar-layout flex-1 flex min-h-0 overflow-hidden">
        {/* Left: 42-cell Calendar Grid */}
        <div className="calendar-month flex-1 flex flex-col min-w-0 border-r border-slate-200 overflow-y-auto p-4">
          {/* Weekday Bar */}
          <div className="grid grid-cols-7 gap-1.5 mb-2 text-center text-xs font-semibold text-slate-400">
            {weekDays.map((w, idx) => (
              <div key={idx} className={idx >= 5 ? 'text-amber-600/80' : ''}>
                周{w}
              </div>
            ))}
          </div>

          {/* 42 Cells Grid */}
          <div className="calendar-days grid grid-cols-7 gap-1.5 flex-1 min-h-0">
            {gridCells.map((cell) => {
              const isSelected = cell.dateStr === selectedDateStr;
              const hasCompletions = cell.leafCompletedCount > 0 || cell.branchClosureCount > 0;

              return (
                <div
                  key={cell.dateStr}
                  onClick={() => setSelectedDateStr(cell.dateStr)}
                  className={`min-h-[78px] p-1.5 rounded-xl border flex flex-col justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-100 shadow-2xs'
                      : cell.isCurrentMonth
                      ? 'border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                      : 'border-slate-100 bg-slate-50/40 text-slate-300'
                  }`}
                >
                  {/* Top line: Day number + Today indicator */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold leading-none ${
                        cell.isToday
                          ? 'w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[11px]'
                          : cell.isCurrentMonth
                          ? isSelected
                            ? 'text-blue-700'
                            : 'text-slate-700'
                          : 'text-slate-300'
                      }`}
                    >
                      {cell.day}
                    </span>

                    {/* Completion count badge */}
                    {hasCompletions && (
                      <div className="flex items-center gap-1">
                        {cell.leafCompletedCount > 0 && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1 py-0.2 rounded">
                            {cell.leafCompletedCount}条
                          </span>
                        )}
                        {cell.branchClosureCount > 0 && (
                          <span className="text-[9px] text-slate-400 font-medium">
                            闭环{cell.branchClosureCount}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Task Title Previews */}
                  <div className="mt-1 space-y-0.5 min-w-0">
                    {cell.previews.map((title, pIdx) => (
                      <div
                        key={pIdx}
                        className="text-[10px] text-slate-600 truncate leading-tight bg-slate-50/80 rounded px-1 py-0.5 border border-slate-100"
                        title={title}
                      >
                        {title}
                      </div>
                    ))}
                    {cell.hasMorePreviews > 0 && (
                      <div className="text-[9px] text-slate-400 font-medium pl-1 leading-tight">
                        +{cell.hasMorePreviews}项
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Day Detailed List (~40%) */}
        <div className="calendar-day-detail w-[380px] lg:w-[420px] flex-shrink-0 flex flex-col min-h-0 bg-slate-50/50">
          {/* Day Heading */}
          <div className="p-4 border-b border-slate-200/80 bg-white flex items-center justify-between flex-shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  {selectedDateStr}
                  {selectedDateStr === todayStr && (
                    <span className="ml-2 text-[11px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      今天
                    </span>
                  )}
                </h3>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>完成 {dayDetail.leafCompletedCount} 条任务</span>
                {dayDetail.branchClosureCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-slate-500 font-medium">
                      闭环 {dayDetail.branchClosureCount} 项父分支
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Details Content List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {dayDetail.projectGroups.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 mb-3">
                  <Inbox className="w-6 h-6 stroke-[1.5]" />
                </div>
                <div className="text-xs font-semibold text-slate-600">这一天没有完成记录</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  该日期未有确认完成或闭环的任务事项
                </div>
              </div>
            ) : (
              dayDetail.projectGroups.map((group) => (
                <div
                  key={group.projectId}
                  className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-2xs space-y-2.5"
                >
                  {/* Group Title */}
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 pb-1.5 border-b border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-blue-600" />
                      <span className="truncate max-w-[220px]">{group.projectTitle}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-normal">
                      {group.items.length} 条记录
                    </span>
                  </div>

                  {/* Items */}
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <div
                        key={item.eventId}
                        className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-slate-50 border border-slate-100 transition-colors"
                      >
                        {/* Title line */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <CheckCircle2
                              className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                                item.isLeaf ? 'text-emerald-500' : 'text-blue-500'
                              }`}
                            />
                            <div className="text-xs font-semibold text-slate-800 leading-snug break-words">
                              {item.title}
                            </div>
                          </div>

                          {/* Time */}
                          <span className="text-[11px] text-slate-400 font-mono flex-shrink-0">
                            {item.timeStr}
                          </span>
                        </div>

                        {/* Breadcrumbs Path */}
                        {item.path && (
                          <div className="text-[10px] text-slate-400 pl-5.5 truncate">
                            {item.path}
                          </div>
                        )}

                        {/* Outcome Note */}
                        {item.outcomeNote && (
                          <div className="text-[11px] text-slate-600 bg-slate-50 rounded p-1.5 ml-5.5 border border-slate-100 italic">
                            “{item.outcomeNote}”
                          </div>
                        )}

                        {/* Bottom tags */}
                        <div className="flex items-center justify-between pt-1 ml-5.5 text-[10px]">
                          <div className="flex items-center gap-1.5">
                            {item.completionMethod === 'direct' && (
                              <span className="text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-medium">
                                直接确认
                              </span>
                            )}
                            {item.completionMethod === 'batch_with_parent' && (
                              <span className="text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded font-medium">
                                随父任务批量完成
                              </span>
                            )}
                            {item.completionMethod === 'auto_closure' && (
                              <span className="text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded font-medium">
                                父节点自动闭环
                              </span>
                            )}

                            {item.isCurrentlyReopened && (
                              <span className="text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded font-medium flex items-center gap-0.5">
                                <RotateCcw className="w-2.5 h-2.5" />
                                <span>当前已重新开启</span>
                              </span>
                            )}
                          </div>

                          {onNavigateToTree && (
                            <button
                              onClick={() => onNavigateToTree(item.taskId)}
                              className="text-blue-600 hover:text-blue-800 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              在树中定位
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
