import React, { useState } from 'react';
import { TaskNode } from '../../types/todo';
import {
  getAncestorPath,
  getAncestorNodes,
  getDescendantTasks
} from '../../services/treeOperations';
import {
  RotateCcw,
  Sparkles,
  Trash2,
  Calendar,
  CheckCircle2,
  Search
} from 'lucide-react';

interface CompletedViewProps {
  tasks: TaskNode[];
  onRestoreTask: (task: TaskNode, includeDescendants: boolean) => void;
  onDeleteTask: (task: TaskNode) => void;
  onSelectTask: (task: TaskNode) => void;
}

export const CompletedView: React.FC<CompletedViewProps> = ({
  tasks,
  onRestoreTask,
  onDeleteTask,
  onSelectTask,
}) => {
  const [filterRange, setFilterRange] = useState<'all' | 'today' | 'week'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const completedTasks = tasks
    .filter(t => !t.deleted_at && t.status === 'done')
    .sort((a, b) => {
      const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return timeB - timeA;
    });

  const filteredTasks = completedTasks.filter(t => {
    if (searchQuery.trim()) {
      if (!t.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
    }

    if (filterRange === 'today') {
      if (!t.completed_at) return false;
      const completedDay = t.completed_at.split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      return completedDay === today;
    }

    if (filterRange === 'week') {
      if (!t.completed_at) return false;
      const diffMs = Date.now() - new Date(t.completed_at).getTime();
      return diffMs <= 7 * 86400000;
    }

    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">已完成任务</h2>
          <p className="text-xs text-slate-400 mt-1">
            共完成 {completedTasks.length} 项任务，支持单项或整树恢复
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-medium text-slate-600">
            <button
              onClick={() => setFilterRange('all')}
              className={`px-3 py-1 rounded-md transition-colors ${
                filterRange === 'all' ? 'bg-white text-blue-600 font-semibold shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setFilterRange('today')}
              className={`px-3 py-1 rounded-md transition-colors ${
                filterRange === 'today' ? 'bg-white text-blue-600 font-semibold shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              今天完成
            </button>
            <button
              onClick={() => setFilterRange('week')}
              className={`px-3 py-1 rounded-md transition-colors ${
                filterRange === 'week' ? 'bg-white text-blue-600 font-semibold shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              最近 7 天
            </button>
          </div>
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">暂无符合条件的已完成任务</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map(task => {
            const ancestors = getAncestorPath(tasks, task);
            const completedDateStr = task.completed_at
              ? new Date(task.completed_at).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '未知时间';

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task)}
                className="group bg-white rounded-xl p-3.5 border border-slate-200/80 hover:border-slate-300 flex items-center justify-between gap-4 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-500 line-through truncate">
                      {task.title}
                    </div>
                    {ancestors.length > 0 && (
                      <div className="text-[11px] text-slate-400 truncate">
                        {ancestors.join(' / ')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-xs text-slate-400 font-medium">
                    完成于 {completedDateStr}
                  </span>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreTask(task, false);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg font-medium transition-colors"
                      title="恢复此任务（若上级已完成将同步恢复上级）"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>恢复</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreTask(task, true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium transition-colors"
                      title="恢复此任务及全部后代"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>恢复整树</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask(task);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                      title="移入回收站"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
