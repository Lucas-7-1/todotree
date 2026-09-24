import React, { useState, useEffect, useRef } from 'react';
import {
  TaskNode,
  QuadrantType,
  QuadrantLevelFilter
} from '../../types/todo';
import {
  getAncestorPath,
  formatRelativeDate,
  getLeafDescendants
} from '../../services/treeOperations';
import { createDragGhost, cleanupDragGhost } from '../../services/dragGhost';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  GripVertical,
  Check,
  Info,
  ArrowDownCircle,
  X
} from 'lucide-react';

interface QuadrantPanelProps {
  tasks: TaskNode[];
  onUpdateQuadrant: (taskId: string, quadrant: QuadrantType) => void;
  onToggleComplete: (task: TaskNode) => void;
  onSelectTask: (task: TaskNode) => void;
  selectedTaskId: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onClose?: () => void;
}

export const QuadrantPanel: React.FC<QuadrantPanelProps> = ({
  tasks,
  onUpdateQuadrant,
  onToggleComplete,
  onSelectTask,
  selectedTaskId,
  isCollapsed,
  onToggleCollapse,
  onClose,
}) => {
  const [levelFilter, setLevelFilter] = useState<QuadrantLevelFilter>('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [dragOverQuadrant, setDragOverQuadrant] = useState<string | null>(null);
  const [isUnclassifiedCollapsed, setIsUnclassifiedCollapsed] = useState(false);
  const ghostRef = useRef<HTMLElement | null>(null);

  // Global listeners to clean up drag states on window dragend or Escape key
  useEffect(() => {
    const handleWindowDragEnd = () => {
      setDragOverQuadrant(null);
      cleanupDragGhost(ghostRef.current);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDragOverQuadrant(null);
        cleanupDragGhost(ghostRef.current);
      }
    };

    window.addEventListener('dragend', handleWindowDragEnd);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (isCollapsed) {
    return (
      <div className="w-12 h-screen flex-shrink-0 bg-white border-l border-slate-200/80 flex flex-col items-center py-6 select-none">
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition-colors mb-6"
          title="展开四象限看板"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="writing-vertical text-xs font-semibold text-slate-500 tracking-wider flex items-center gap-2">
          <span>四象限看板</span>
        </div>
      </div>
    );
  }

  // Filter tasks based on level mode
  const activeTasks = tasks.filter(t => !t.deleted_at && t.status === 'open');

  const filteredTasks = activeTasks.filter(t => {
    if (levelFilter === 'root_only') {
      return t.parent_id === null;
    }
    if (levelFilter === 'leaf_only') {
      const leaves = getLeafDescendants(tasks, t.id);
      return leaves.length === 0;
    }
    return true; // 'all'
  });

  const q1Tasks = filteredTasks.filter(t => t.quadrant === 'Q1');
  const q2Tasks = filteredTasks.filter(t => t.quadrant === 'Q2');
  const q3Tasks = filteredTasks.filter(t => t.quadrant === 'Q3');
  const q4Tasks = filteredTasks.filter(t => t.quadrant === 'Q4');
  const unclassifiedTasks = filteredTasks.filter(t => t.quadrant === null);

  // Drag start from quadrant cards or chips
  const handleDragStart = (e: React.DragEvent, task: TaskNode) => {
    e.stopPropagation();
    const ancestors = getAncestorPath(tasks, task);
    const ghost = createDragGhost(task.title, ancestors.join(' / '));
    ghostRef.current = ghost;

    e.dataTransfer.setDragImage(ghost, 15, 15);
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'todotree-task',
        taskId: task.id,
        title: task.title,
        source: 'quadrant-card',
        currentQuadrant: task.quadrant,
      })
    );
    e.dataTransfer.effectAllowed = 'move';

    setTimeout(() => {
      cleanupDragGhost(ghost);
    }, 0);
  };

  // Robust drag over without flickering
  const handleDragOver = (e: React.DragEvent, qKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverQuadrant !== qKey) {
      setDragOverQuadrant(qKey);
    }
  };

  // Only clear when truly leaving the quadrant box container
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverQuadrant(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetQuadrant: QuadrantType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverQuadrant(null);
    cleanupDragGhost(ghostRef.current);

    const rawData = e.dataTransfer.getData('application/json');
    if (!rawData) return;
    try {
      const data = JSON.parse(rawData);
      if (data.taskId) {
        onUpdateQuadrant(data.taskId, targetQuadrant);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const levelFilterLabels: Record<QuadrantLevelFilter, string> = {
    all: '全部层级',
    root_only: '仅大类',
    leaf_only: '仅末级任务',
  };

  // Quadrant configurations
  const quadrantMeta = {
    Q1: {
      title: '重要且紧急',
      dotColor: 'bg-red-500',
      activeBorder: 'border-2 !border-red-500 bg-red-100/60 ring-2 ring-red-200/80 shadow-md',
      normalBg: 'bg-red-50/30',
      normalBorder: 'border-red-100',
      tagText: 'text-red-600',
      promptText: '松手设为重要且紧急',
    },
    Q2: {
      title: '重要不紧急',
      dotColor: 'bg-blue-500',
      activeBorder: 'border-2 !border-blue-500 bg-blue-100/60 ring-2 ring-blue-200/80 shadow-md',
      normalBg: 'bg-blue-50/30',
      normalBorder: 'border-blue-100',
      tagText: 'text-blue-600',
      promptText: '松手设为重要不紧急',
    },
    Q3: {
      title: '紧急不重要',
      dotColor: 'bg-amber-500',
      activeBorder: 'border-2 !border-amber-500 bg-amber-100/60 ring-2 ring-amber-200/80 shadow-md',
      normalBg: 'bg-amber-50/30',
      normalBorder: 'border-amber-100',
      tagText: 'text-amber-700',
      promptText: '松手设为紧急不重要',
    },
    Q4: {
      title: '不重要不紧急',
      dotColor: 'bg-slate-400',
      activeBorder: 'border-2 !border-slate-500 bg-slate-100/90 ring-2 ring-slate-300 shadow-md',
      normalBg: 'bg-slate-50',
      normalBorder: 'border-slate-200/70',
      tagText: 'text-slate-600',
      promptText: '松手设为不重要不紧急',
    },
  };

  // Helper to render quadrant box
  const renderQuadrantBox = (
    qKey: 'Q1' | 'Q2' | 'Q3' | 'Q4',
    tasksList: TaskNode[],
  ) => {
    const meta = quadrantMeta[qKey];
    const isDragTarget = dragOverQuadrant === qKey;

    return (
      <div
        onDragOver={(e) => handleDragOver(e, qKey)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, qKey)}
        className={`h-full min-h-0 rounded-2xl p-3 flex flex-col transition-all border relative select-none overflow-hidden ${
          isDragTarget ? meta.activeBorder : `${meta.normalBg} ${meta.normalBorder}`
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1.5 mb-1 pointer-events-none flex-shrink-0">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-800">
            <span className={`w-2 h-2 rounded-full ${meta.dotColor}`} />
            <span>{meta.title}</span>
          </div>
          <span className="text-[11px] font-medium text-slate-400">
            {tasksList.length}
          </span>
        </div>

        {/* Content Area: when dragging over, display centered drop target matching mockup */}
        {isDragTarget ? (
          <div className="flex-1 flex flex-col items-center justify-center p-3 pointer-events-none animate-in fade-in zoom-in-95 duration-100 select-none">
            <div className={`${meta.tagText} mb-2`}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v13" />
                <path d="m7 11 5 5 5-5" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <div className="text-xs font-bold text-slate-800 text-center leading-snug">
              松手设为
              <br />
              {meta.title}
            </div>
            <div className="text-[10px] text-slate-400 mt-2 text-center">
              仅修改此任务
            </div>
          </div>
        ) : (
          /* Normal Task Cards List */
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
            {tasksList.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs py-6 border border-dashed border-slate-200/80 rounded-xl text-slate-400">
                拖拽任务至此处
              </div>
            ) : (
              tasksList.map(task => {
                const ancestors = getAncestorPath(tasks, task);
                const dateInfo = formatRelativeDate(task);
                const isSelected = selectedTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task)}
                    onClick={() => onSelectTask(task)}
                    className={`bg-white rounded-xl p-2.5 shadow-xs border transition-all cursor-pointer group flex items-start gap-2 ${
                      isSelected ? 'border-blue-400 ring-2 ring-blue-50' : 'border-slate-200/70 hover:border-slate-300'
                    }`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleComplete(task);
                      }}
                      className="w-4 h-4 rounded mt-0.5 flex-shrink-0 flex items-center justify-center border border-slate-300 hover:border-blue-500 bg-white"
                    >
                      {task.status === 'done' && <Check className="w-3 h-3 text-blue-600 stroke-[3]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {task.title}
                      </div>

                      {ancestors.length > 0 && (
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {ancestors.join(' / ')}
                        </div>
                      )}

                      {dateInfo.label !== '-' && (
                        <div className="mt-1">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                              dateInfo.isOverdue
                                ? 'text-red-600 bg-red-50'
                                : dateInfo.isToday
                                ? 'text-amber-600 bg-amber-50'
                                : 'text-slate-500 bg-slate-50'
                            }`}
                          >
                            {dateInfo.label}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-slate-300 group-hover:text-slate-500 cursor-grab pt-0.5 flex-shrink-0">
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  const isUnclassifiedDragTarget = dragOverQuadrant === 'null';

  return (
    <aside className="w-[420px] max-w-full h-screen flex-shrink-0 bg-white border-l border-slate-200/90 shadow-2xl z-40 flex flex-col p-4 select-none overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 flex-shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">四象限</h2>
          <p className="text-[11px] text-slate-400">手动划分，父子项独立</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Level Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <span>{levelFilterLabels[levelFilter]}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-30 space-y-0.5">
                {(['all', 'root_only', 'leaf_only'] as QuadrantLevelFilter[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setLevelFilter(mode);
                      setShowFilterDropdown(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg ${
                      levelFilter === mode ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {levelFilterLabels[mode]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close / Collapse Button */}
          <button
            onClick={onClose || onToggleCollapse}
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
            title="关闭四象限速览"
          >
            {onClose ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2x2 Matrix (PRD v1.1 Section 7.1) */}
      <div
        className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 my-2"
        style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)' }}
      >
        {/* Q1: 重要且紧急 (Red) */}
        {renderQuadrantBox('Q1', q1Tasks)}

        {/* Q2: 重要不紧急 (Blue) */}
        {renderQuadrantBox('Q2', q2Tasks)}

        {/* Q3: 紧急不重要 (Amber) */}
        {renderQuadrantBox('Q3', q3Tasks)}

        {/* Q4: 不重要不紧急 (Slate) */}
        {renderQuadrantBox('Q4', q4Tasks)}
      </div>

      {/* Bottom Unclassified Section (PRD v1.1 Section 7.1 max-height ≤ 120px, collapsible) */}
      <div className="pt-2 border-t border-slate-100 flex-shrink-0">
        <div
          onDragOver={(e) => handleDragOver(e, 'null')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, null)}
          className={`rounded-xl p-2.5 border transition-all ${
            isUnclassifiedDragTarget
              ? 'border-2 !border-purple-500 bg-purple-100/70 shadow-md ring-2 ring-purple-200'
              : 'border-slate-100 bg-slate-50/60'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>未分类</span>
              <span className="text-[10px] text-slate-400 font-normal">({unclassifiedTasks.length})</span>
            </div>
            <div className="flex items-center gap-1">
              <span
                className={`text-[10px] font-medium transition-colors ${
                  isUnclassifiedDragTarget ? 'text-purple-700 font-bold' : 'text-slate-400'
                }`}
              >
                {isUnclassifiedDragTarget ? '松手移入未分类' : '拖入象限或点击选择'}
              </span>
              <button
                type="button"
                onClick={() => setIsUnclassifiedCollapsed(!isUnclassifiedCollapsed)}
                className="w-5 h-5 rounded hover:bg-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors ml-1"
                title={isUnclassifiedCollapsed ? '展开未分类' : '折叠未分类'}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isUnclassifiedCollapsed ? '-rotate-90' : ''}`} />
              </button>
            </div>
          </div>

          {!isUnclassifiedCollapsed && (
            isUnclassifiedDragTarget ? (
              <div className="py-2 flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-100">
                <div className="text-purple-600 mb-0.5">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13" />
                    <path d="m7 11 5 5 5-5" />
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                </div>
                <div className="text-xs font-bold text-purple-700">松手移入未分类 (清除象限)</div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-[85px] overflow-y-auto">
                {unclassifiedTasks.length === 0 ? (
                  <span className="text-[11px] text-slate-400 py-1">暂无未分类任务</span>
                ) : (
                  unclassifiedTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task)}
                      onClick={() => onSelectTask(task)}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-600 transition-colors cursor-grab flex items-center gap-1 shadow-2xs"
                    >
                      <span className="truncate max-w-[90px]">{task.title}</span>
                    </div>
                  ))
                )}
              </div>
            )
          )}
        </div>

        {/* Footer Note */}
        <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-slate-400">
          <Info className="w-3 h-3 text-slate-400" />
          <span>修改父项，不会改变子项</span>
        </div>
      </div>
    </aside>
  );
};
