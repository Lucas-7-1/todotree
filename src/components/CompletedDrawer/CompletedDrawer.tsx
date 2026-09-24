import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TaskNode } from '../../types/todo';
import { getAncestorPath, getDescendantTasks } from '../../services/treeOperations';
import {
  X,
  RotateCcw,
  Search,
  CheckCircle2,
  Calendar,
  FolderTree,
  Repeat,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Info,
  Clock,
  ArrowRight
} from 'lucide-react';

interface CompletedDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: TaskNode[];
  onRestoreTask: (taskId: string, includeSubtree: boolean) => void;
  onSelectTask: (task: TaskNode) => void;
  initialScopeRootId?: string | null;
  initialDateFilter?: 'all' | 'today' | 'yesterday' | 'earlier';
}

const PAGE_SIZE = 50;

export const CompletedDrawer: React.FC<CompletedDrawerProps> = ({
  isOpen,
  onClose,
  tasks,
  onRestoreTask,
  onSelectTask,
  initialScopeRootId = null,
  initialDateFilter = 'all',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [scopeRootId, setScopeRootId] = useState<string | null>(initialScopeRootId);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'earlier'>(initialDateFilter);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // 250ms debounced search (PRD 6.3)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setDisplayCount(PAGE_SIZE);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync initial props when opened
  useEffect(() => {
    if (isOpen) {
      setScopeRootId(initialScopeRootId || null);
      setDateFilter(initialDateFilter || 'all');
      setDisplayCount(PAGE_SIZE);
      setExpandedRowId(null);
    }
  }, [isOpen, initialScopeRootId, initialDateFilter]);

  // Keyboard shortcut: Esc to close drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Root projects for scope filter
  const rootProjects = useMemo(() => {
    return tasks.filter((t) => !t.deleted_at && t.parent_id === null);
  }, [tasks]);

  // Filter completed tasks
  const filteredCompletedTasks = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterdayDate = new Date(Date.now() - 86400000);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    // 1. Gather all tasks marked done
    let list = tasks.filter((t) => !t.deleted_at && t.status === 'done');

    // 2. Scope filter (if a root project is selected, match that root or its descendants)
    if (scopeRootId) {
      const descendants = getDescendantTasks(tasks, scopeRootId);
      const allowedIds = new Set([scopeRootId, ...descendants.map((d) => d.id)]);
      list = list.filter((t) => allowedIds.has(t.id));
    }

    // 3. Search query filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.note && t.note.toLowerCase().includes(q)) ||
          (t.outcome_note && t.outcome_note.toLowerCase().includes(q))
      );
    }

    // 4. Date filter
    if (dateFilter !== 'all') {
      list = list.filter((t) => {
        if (!t.completed_at) return dateFilter === 'earlier';
        const day = t.completed_at.split('T')[0];
        if (dateFilter === 'today') return day === todayStr;
        if (dateFilter === 'yesterday') return day === yesterdayStr;
        if (dateFilter === 'earlier') return day < yesterdayStr;
        return true;
      });
    }

    // 5. Stable Sort: completed_at DESC, id DESC (PRD 6.3)
    return list.sort((a, b) => {
      const tA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const tB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      if (tB !== tA) return tB - tA;
      return b.id.localeCompare(a.id);
    });
  }, [tasks, scopeRootId, debouncedSearch, dateFilter]);

  if (!isOpen) return null;

  const totalCount = filteredCompletedTasks.length;
  const paginatedTasks = filteredCompletedTasks.slice(0, displayCount);
  const hasMore = displayCount < totalCount;

  // Format date helper
  const formatCompletedTime = (isoStr: string | null) => {
    if (!isoStr) return '完成时间未知';
    const date = new Date(isoStr);
    const today = new Date().toISOString().split('T')[0];
    const datePart = isoStr.split('T')[0];
    const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (datePart === today) return `今天 ${timePart}`;
    const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (datePart === yest) return `昨天 ${timePart}`;
    return `${datePart} ${timePart}`;
  };

  return (
    <aside className="w-[420px] max-w-full h-screen flex-shrink-0 bg-white border-l border-slate-200/90 flex flex-col z-40 shadow-2xl select-none animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800 tracking-tight">已完成</h2>
              <span className="text-xs font-semibold px-2 py-0.5 bg-blue-100/70 text-blue-700 rounded-full">
                {totalCount}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">历史完成记录与追溯，支持单项或整树恢复</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          title="关闭抽屉 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="p-3 border-b border-slate-100 space-y-2 bg-white">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="搜索已完成任务或成果..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none transition-all"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Scope & Date Filters */}
        <div className="flex items-center gap-2">
          {/* Project Scope Selector */}
          <select
            value={scopeRootId || ''}
            onChange={(e) => {
              setScopeRootId(e.target.value || null);
              setDisplayCount(PAGE_SIZE);
            }}
            className="flex-1 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-600 outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">全部项目范围</option>
            {rootProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          {/* Date Segmented Controls */}
          <div className="flex bg-slate-100 rounded-lg p-0.5 text-[11px] font-medium text-slate-600">
            {(
              [
                { key: 'all', label: '全部' },
                { key: 'today', label: '今天' },
                { key: 'yesterday', label: '昨天' },
                { key: 'earlier', label: '更早' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setDateFilter(tab.key);
                  setDisplayCount(PAGE_SIZE);
                }}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  dateFilter === tab.key
                    ? 'bg-white text-blue-600 font-bold shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {paginatedTasks.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <span>无匹配的已完成任务</span>
          </div>
        ) : (
          paginatedTasks.map((task) => {
            const ancestors = getAncestorPath(tasks, task);
            const isExpanded = expandedRowId === task.id;

            return (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-2xs hover:border-slate-300 transition-all text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-700 line-through truncate">
                        {task.title}
                      </span>
                      {task.recurrence_rule_id && (
                        <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.2 rounded font-medium flex items-center gap-0.5">
                          <Repeat className="w-2.5 h-2.5" />
                          <span>重复</span>
                        </span>
                      )}
                    </div>

                    {/* Path & Time */}
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                      {ancestors.length > 0 && (
                        <span className="truncate max-w-[180px]">{ancestors.join(' / ')}</span>
                      )}
                      <span>·</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{formatCompletedTime(task.completed_at)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Restore Action Button */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onRestoreTask(task.id, false)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1"
                      title="恢复此任务到待办 (若祖先已完成将自动一并恢复)"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>恢复</span>
                    </button>
                    <button
                      onClick={() => setExpandedRowId(isExpanded ? null : task.id)}
                      className="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors"
                      title="展开详情 / 更多操作"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                {/* Expanded Details / Subtree Restore */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2 animate-in fade-in duration-100">
                    {task.outcome_note && (
                      <div className="bg-emerald-50/60 border border-emerald-200/60 rounded-lg p-2 text-[11px] text-emerald-800">
                        <span className="font-bold">成果说明: </span>
                        <span>{task.outcome_note}</span>
                      </div>
                    )}
                    {task.note && (
                      <div className="bg-slate-50 rounded-lg p-2 text-[11px] text-slate-600">
                        <span className="font-bold">备注: </span>
                        <span>{task.note}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        onClick={() => onSelectTask(task)}
                        className="text-[11px] text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
                      >
                        <span>查看完整详情</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => onRestoreTask(task.id, true)}
                        className="text-[11px] text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded transition-colors font-medium"
                        title="恢复当前任务及所有已完成的子孙节点"
                      >
                        恢复整棵子树
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Load More Button (PRD 6.3 cursor-like pagination) */}
        {hasMore && (
          <div className="pt-2 pb-4 text-center">
            <button
              onClick={() => setDisplayCount((prev) => prev + PAGE_SIZE)}
              className="px-4 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              加载更多 (剩余 {totalCount - displayCount} 条)
            </button>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[11px] text-slate-400">
        <span>已显示 {Math.min(displayCount, totalCount)} / {totalCount} 条</span>
        <div className="flex items-center gap-1">
          <Info className="w-3 h-3" />
          <span>恢复任务不影响既有优先级与截止日期</span>
        </div>
      </div>
    </aside>
  );
};
