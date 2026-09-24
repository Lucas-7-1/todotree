import React, { useState, useMemo } from 'react';
import { TaskNode } from '../../types/todo';
import {
  RotateCcw,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  FileText
} from 'lucide-react';

interface TrashViewProps {
  tasks: TaskNode[];
  onRestoreBatch: (batchId: string) => void;
  onRestoreSingleTask?: (taskId: string) => void;
  onPermanentlyDeleteBatch: (batchId: string) => void;
  onPermanentlyDeleteTask?: (taskId: string) => void;
  onClearAllTrash: () => void;
}

type DateFilterType = 'all' | 'today' | 'yesterday' | 'older';

export const TrashView: React.FC<TrashViewProps> = ({
  tasks,
  onRestoreBatch,
  onRestoreSingleTask,
  onPermanentlyDeleteBatch,
  onPermanentlyDeleteTask,
  onClearAllTrash,
}) => {
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteBatchId, setConfirmDeleteBatchId] = useState<string | null>(null);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // 1. Get all deleted tasks
  const allDeletedTasks = useMemo(() => {
    return tasks.filter((t) => t.deleted_at !== null);
  }, [tasks]);

  // 2. Filter deleted tasks by date and keyword (PRD v1.2 A25)
  const filteredTasks = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const lowerKeyword = searchKeyword.trim().toLowerCase();

    return allDeletedTasks.filter((t) => {
      // Keyword match
      if (lowerKeyword && !t.title.toLowerCase().includes(lowerKeyword)) {
        return false;
      }

      // Date match
      if (dateFilter !== 'all' && t.deleted_at) {
        const deletedTime = new Date(t.deleted_at).getTime();
        if (dateFilter === 'today') {
          if (deletedTime < todayStart) return false;
        } else if (dateFilter === 'yesterday') {
          if (deletedTime < yesterdayStart || deletedTime >= todayStart) return false;
        } else if (dateFilter === 'older') {
          if (deletedTime >= yesterdayStart) return false;
        }
      }

      return true;
    });
  }, [allDeletedTasks, searchKeyword, dateFilter]);

  // 3. Group filtered tasks by deletion_batch_id
  const batchEntries = useMemo(() => {
    const batchesMap = new Map<string, TaskNode[]>();
    for (const t of filteredTasks) {
      const batchId = t.deletion_batch_id || 'legacy-batch';
      const list = batchesMap.get(batchId) || [];
      list.push(t);
      batchesMap.set(batchId, list);
    }

    return Array.from(batchesMap.entries()).sort((a, b) => {
      const timeA = a[1][0]?.deleted_at ? new Date(a[1][0].deleted_at!).getTime() : 0;
      const timeB = b[1][0]?.deleted_at ? new Date(b[1][0].deleted_at!).getTime() : 0;
      return timeB - timeA;
    });
  }, [filteredTasks]);

  // 4. Cursor / page pagination on batchEntries (50 items/page target, 10 batches/page)
  const totalBatches = batchEntries.length;
  const totalTasksInFilter = filteredTasks.length;
  const totalPages = Math.max(1, Math.ceil(totalBatches / 10));
  const paginatedBatches = useMemo(() => {
    const start = (currentPage - 1) * 10;
    return batchEntries.slice(start, start + 10);
  }, [batchEntries, currentPage]);

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">回收站</h2>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
              共 {allDeletedTasks.length} 项已删除
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            软删除任务保留完整属性与层级结构，支持单项恢复、批次恢复与物理粉碎。
          </p>
        </div>

        {allDeletedTasks.length > 0 && (
          <div className="flex-shrink-0">
            {confirmClearAll ? (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 p-1.5 rounded-xl animate-in fade-in">
                <span className="text-xs text-rose-700 font-semibold px-1">确认永久清空全部回收站？</span>
                <button
                  onClick={() => {
                    onClearAllTrash();
                    setConfirmClearAll(false);
                  }}
                  className="px-3 py-1 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 transition-colors shadow-xs"
                >
                  确定清空
                </button>
                <button
                  onClick={() => setConfirmClearAll(false)}
                  className="px-2.5 py-1 bg-white text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClearAll(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200/60 rounded-xl text-xs font-semibold transition-colors shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空回收站</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filter & Search Bar (A25) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="搜索被删除任务标题..."
            value={searchKeyword}
            onChange={(e) => {
              setSearchKeyword(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-700 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
          {searchKeyword && (
            <button
              onClick={() => {
                setSearchKeyword('');
                setCurrentPage(1);
              }}
              className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          )}
        </div>

        {/* Date Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'today', label: '今天' },
              { key: 'yesterday', label: '昨天' },
              { key: 'older', label: '更早' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setDateFilter(item.key);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateFilter === item.key
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content list */}
      {paginatedBatches.length === 0 ? (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80">
          <Trash2 className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-[1.5]" />
          <p className="text-sm font-medium text-slate-600">
            {searchKeyword || dateFilter !== 'all' ? '未找到符合条件的已删除任务' : '回收站空空如也'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {searchKeyword || dateFilter !== 'all' ? '请尝试清除过滤条件' : '在任务列表中删除的项会安全暂存在这里'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedBatches.map(([batchId, batchTasks]) => {
            const firstTask = batchTasks[0];
            const deleteTimeStr = firstTask?.deleted_at
              ? new Date(firstTask.deleted_at).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '未知时间';

            const isConfirmingBatchDel = confirmDeleteBatchId === batchId;

            return (
              <div
                key={batchId}
                className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-xs space-y-3 hover:border-slate-300 transition-colors"
              >
                {/* Batch Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-slate-800">
                      批次包含 {batchTasks.length} 项任务
                    </span>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      删除于 {deleteTimeStr}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onRestoreBatch(batchId)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-semibold rounded-lg transition-colors"
                      title="将该批次下所有任务完整还原"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>恢复此批次</span>
                    </button>

                    {isConfirmingBatchDel ? (
                      <div className="flex items-center gap-1.5 animate-in fade-in">
                        <span className="text-[11px] text-rose-600 font-semibold">彻底删除整批？</span>
                        <button
                          onClick={() => {
                            onPermanentlyDeleteBatch(batchId);
                            setConfirmDeleteBatchId(null);
                          }}
                          className="px-2 py-0.5 bg-rose-600 text-white text-xs font-semibold rounded hover:bg-rose-700 transition-colors"
                        >
                          确定
                        </button>
                        <button
                          onClick={() => setConfirmDeleteBatchId(null)}
                          className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded hover:bg-slate-200 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteBatchId(batchId)}
                        className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs rounded-lg transition-colors"
                        title="彻底删除此批次（不可逆物理删除）"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>彻底删除</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Items in this batch */}
                <div className="space-y-1.5 pl-1">
                  {batchTasks.map((t) => {
                    const isConfirmingTaskDel = confirmDeleteTaskId === t.id;

                    return (
                      <div
                        key={t.id}
                        className="group flex items-center justify-between text-xs py-1.5 px-2 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2 overflow-hidden mr-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                          <span className="font-medium text-slate-700 truncate" title={t.title}>
                            {t.title}
                          </span>
                          {t.quadrant && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                              {t.quadrant}
                            </span>
                          )}
                          {t.background_text && (
                            <span className="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200/60 px-1 rounded flex-shrink-0">
                              背景
                            </span>
                          )}
                          {t.note && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1 rounded flex-shrink-0">
                              备注
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100 flex-shrink-0">
                          {onRestoreSingleTask && (
                            <button
                              onClick={() => onRestoreSingleTask(t.id)}
                              className="flex items-center gap-0.5 px-2 py-0.5 text-blue-600 hover:bg-blue-100 rounded text-[11px] font-medium transition-colors"
                              title="单独还原此项"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>恢复</span>
                            </button>
                          )}

                          {isConfirmingTaskDel ? (
                            <div className="flex items-center gap-1 animate-in fade-in">
                              <span className="text-[10px] text-rose-600 font-semibold">彻底删除？</span>
                              <button
                                onClick={() => {
                                  if (onPermanentlyDeleteTask) onPermanentlyDeleteTask(t.id);
                                  setConfirmDeleteTaskId(null);
                                }}
                                className="px-1.5 py-0.2 bg-rose-600 text-white text-[10px] font-semibold rounded hover:bg-rose-700"
                              >
                                确定
                              </button>
                              <button
                                onClick={() => setConfirmDeleteTaskId(null)}
                                className="px-1.5 py-0.2 bg-slate-100 text-slate-600 text-[10px] rounded hover:bg-slate-200"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            onPermanentlyDeleteTask && (
                              <button
                                onClick={() => setConfirmDeleteTaskId(t.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                title="单独彻底删除此项"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            显示第 {(currentPage - 1) * 10 + 1} - {Math.min(currentPage * 10, totalBatches)} 批（共 {totalBatches} 批，{totalTasksInFilter} 项任务）
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-medium text-slate-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
