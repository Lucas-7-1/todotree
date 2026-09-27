import React, { useState, useEffect, useRef } from 'react';
import {
  TaskNode,
  QuadrantType,
  QuadrantLevelFilter,
  DueType,
} from '../../types/todo';
import {
  getAncestorPath,
  formatRelativeDate,
  getLeafDescendants,
} from '../../services/treeOperations';
import { createDragGhost, cleanupDragGhost } from '../../services/dragGhost';
import {
  GripVertical,
  Check,
  Plus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Filter,
  Layers,
  Inbox,
  ArrowDownToLine,
  X,
  Calendar,
  CheckCircle2,
} from 'lucide-react';

interface QuadrantWorkspaceProps {
  tasks: TaskNode[];
  onUpdateQuadrant: (taskId: string, quadrant: QuadrantType) => void;
  onToggleComplete: (task: TaskNode) => void;
  onSelectTask: (task: TaskNode) => void;
  selectedTaskId: string | null;
  onAddTask: (
    title: string,
    parentId: string | null,
    dueType: DueType,
    dueDate: string | null,
    quadrant: QuadrantType
  ) => void;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
  onOpenCompletedDrawer?: () => void;
}

export const QuadrantWorkspace: React.FC<QuadrantWorkspaceProps> = ({
  tasks,
  onUpdateQuadrant,
  onToggleComplete,
  onSelectTask,
  selectedTaskId,
  onAddTask,
  showCompleted,
  onToggleShowCompleted,
  onOpenCompletedDrawer,
}) => {
  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<QuadrantLevelFilter>('all');
  const [showLevelDropdown, setShowLevelDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [isUnclassifiedCollapsed, setIsUnclassifiedCollapsed] = useState(true);

  // Drag states
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  // Inline add input in quadrant
  const [addingQuadrant, setAddingQuadrant] = useState<QuadrantType | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const ghostRef = useRef<HTMLElement | null>(null);

  // Clear drag states on window dragend or Escape
  useEffect(() => {
    const handleDragEnd = () => {
      setDragOverZone(null);
      setDraggingTaskId(null);
      cleanupDragGhost(ghostRef.current);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDragOverZone(null);
        setDraggingTaskId(null);
        setAddingQuadrant(null);
        cleanupDragGhost(ghostRef.current);
      }
    };
    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Root categories for filtering
  const rootCategories = tasks.filter(
    (t) => !t.deleted_at && t.parent_id === null
  );

  // Filter tasks
  const visibleTasks = tasks.filter((t) => {
    if (t.deleted_at) return false;
    if (!showCompleted && t.status === 'done') return false;

    // Category filter
    if (selectedCategory !== 'all') {
      let curr: TaskNode | undefined = t;
      let rootId = t.parent_id === null ? t.id : null;
      while (curr && curr.parent_id) {
        const p: TaskNode | undefined = tasks.find((x) => x.id === curr!.parent_id);
        if (p && p.parent_id === null) {
          rootId = p.id;
          break;
        }
        curr = p;
      }
      if (rootId !== selectedCategory) return false;
    }

    // Level filter
    if (levelFilter === 'root_only') {
      if (t.parent_id !== null) return false;
    } else if (levelFilter === 'leaf_only') {
      const leaves = getLeafDescendants(tasks, t.id);
      if (leaves.length > 0) return false;
    }

    return true;
  });

  const unclassifiedTasks = visibleTasks.filter((t) => t.quadrant === null);
  const q1Tasks = visibleTasks.filter((t) => t.quadrant === 'Q1');
  const q2Tasks = visibleTasks.filter((t) => t.quadrant === 'Q2');
  const q3Tasks = visibleTasks.filter((t) => t.quadrant === 'Q3');
  const q4Tasks = visibleTasks.filter((t) => t.quadrant === 'Q4');

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, task: TaskNode) => {
    e.stopPropagation();
    setDraggingTaskId(task.id);

    const ancestors = getAncestorPath(tasks, task);
    const dateInfo = formatRelativeDate(task);
    const ghost = createDragGhost(
      task.title,
      ancestors.join(' / '),
      dateInfo.label !== '-' ? dateInfo.label : null
    );
    ghostRef.current = ghost;

    e.dataTransfer.setDragImage(ghost, 15, 15);
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'todotree-task',
        taskId: task.id,
        title: task.title,
        currentQuadrant: task.quadrant,
      })
    );
    e.dataTransfer.effectAllowed = 'move';

    setTimeout(() => {
      cleanupDragGhost(ghost);
    }, 0);
  };

  const handleDragOver = (e: React.DragEvent, zoneKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverZone !== zoneKey) {
      setDragOverZone(zoneKey);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverZone(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetQuadrant: QuadrantType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverZone(null);
    setDraggingTaskId(null);
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

  // Inline submit in quadrant
  const handleInlineSubmit = (quadrant: QuadrantType) => {
    const trimmed = newTitle.trim();
    if (trimmed) {
      onAddTask(trimmed, null, 'none', null, quadrant);
      setNewTitle('');
      setAddingQuadrant(null);
    }
  };

  const levelFilterLabels: Record<QuadrantLevelFilter, string> = {
    all: '全部层级',
    root_only: '仅大类',
    leaf_only: '仅末级任务',
  };

  // 4 Quadrants configuration
  const quadrantMeta = {
    Q1: {
      title: '重要且紧急',
      desc: '优先处理',
      dotColor: 'bg-red-500',
      accentBorder: 'border-t-2 border-t-red-500',
      activeRing: 'border-2 !border-red-400 bg-red-50/70 ring-4 ring-red-100/60 shadow-md',
      tagText: 'text-red-600',
    },
    Q2: {
      title: '重要不紧急',
      desc: '安排时间推进',
      dotColor: 'bg-blue-500',
      accentBorder: 'border-t-2 border-t-blue-500',
      activeRing: 'border-2 !border-blue-400 bg-blue-50/70 ring-4 ring-blue-100/60 shadow-md',
      tagText: 'text-blue-600',
    },
    Q3: {
      title: '紧急不重要',
      desc: '尽快处理或转交',
      dotColor: 'bg-amber-500',
      accentBorder: 'border-t-2 border-t-amber-500',
      activeRing: 'border-2 !border-amber-400 bg-amber-50/70 ring-4 ring-amber-100/60 shadow-md',
      tagText: 'text-amber-700',
    },
    Q4: {
      title: '不重要不紧急',
      desc: '延后再看',
      dotColor: 'bg-slate-400',
      accentBorder: 'border-t-2 border-t-slate-400',
      activeRing: 'border-2 !border-slate-400 bg-slate-100/90 ring-4 ring-slate-200/60 shadow-md',
      tagText: 'text-slate-600',
    },
  };

  // Render a clean, non-boxed task card
  const renderTaskCard = (task: TaskNode) => {
    const ancestors = getAncestorPath(tasks, task);
    const dateInfo = formatRelativeDate(task);
    const isSelected = selectedTaskId === task.id;
    const isDone = task.status === 'done';
    const isCurrentDragging = draggingTaskId === task.id;

    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => handleDragStart(e, task)}
        onClick={() => onSelectTask(task)}
        className={`bg-white rounded-xl p-3 border transition-all cursor-pointer group flex flex-col justify-between gap-1.5 ${
          isSelected
            ? 'border-blue-400 ring-2 ring-blue-50 shadow-xs'
            : 'border-slate-200/80 hover:border-slate-300 hover:shadow-xs'
        } ${isCurrentDragging ? 'opacity-40 bg-slate-50/60' : ''}`}
      >
        {/* Top line: Checkbox + Title + Drag handle */}
        <div className="flex items-start gap-2.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(task);
            }}
            className={`w-4 h-4 rounded mt-0.5 flex-shrink-0 flex items-center justify-center border transition-all ${
              isDone
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-slate-300 hover:border-blue-500 bg-white'
            }`}
          >
            {isDone && <Check className="w-3 h-3 stroke-[3]" />}
          </button>

          <div
            className={`text-sm font-semibold text-slate-800 line-clamp-2 flex-1 leading-snug ${
              isDone ? 'line-through text-slate-400' : ''
            }`}
          >
            {task.title}
          </div>

          <div className="text-slate-300 group-hover:text-slate-600 cursor-grab active:cursor-grabbing p-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Middle line: Ancestor path */}
        {ancestors.length > 0 && (
          <div className="text-xs text-slate-400 pl-6.5 truncate">
            {ancestors.join(' / ')}
          </div>
        )}

        {/* Bottom line: Date badge pinned to bottom-right */}
        {dateInfo.label !== '-' && (
          <div className="flex items-center justify-end pl-6.5 pt-0.5">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                dateInfo.isOverdue
                  ? 'text-red-600 bg-red-50'
                  : dateInfo.isToday
                  ? 'text-amber-600 bg-amber-50'
                  : 'text-slate-500 bg-slate-100'
              }`}
            >
              <Calendar className="w-3 h-3" />
              <span>{dateInfo.label}</span>
            </span>
          </div>
        )}
      </div>
    );
  };

  // Render Quadrant Cell
  const renderQuadrantCell = (
    qKey: 'Q1' | 'Q2' | 'Q3' | 'Q4',
    tasksList: TaskNode[]
  ) => {
    const meta = quadrantMeta[qKey];
    const isDragTarget = dragOverZone === qKey;
    const isAdding = addingQuadrant === qKey;

    return (
      <div
        onDragOver={(e) => handleDragOver(e, qKey)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, qKey)}
        className={`bg-white border border-slate-200/90 rounded-2xl shadow-xs flex flex-col min-h-0 overflow-hidden transition-all select-none ${
          meta.accentBorder
        } ${isDragTarget ? meta.activeRing : ''}`}
      >
        {/* Cell Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${meta.dotColor}`} />
            <span className="font-bold text-sm text-slate-800">
              {meta.title}
            </span>
            <span className="text-xs text-slate-400 font-normal">
              {meta.desc}
            </span>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-1">
              {tasksList.length}
            </span>
          </div>

          <button
            onClick={() => {
              setAddingQuadrant(qKey);
              setNewTitle('');
            }}
            className="w-6 h-6 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center transition-colors"
            title={`在${meta.title}中新建任务`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Inline input for quadrant addition */}
        {isAdding && (
          <div className="p-3 border-b border-blue-100 bg-blue-50/40 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              placeholder={`在「${meta.title}」中新增任务，按 Enter 保存...`}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInlineSubmit(qKey);
                if (e.key === 'Escape') setAddingQuadrant(null);
              }}
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-blue-400 rounded-lg outline-none font-medium text-slate-800 shadow-xs"
            />
            <button
              onClick={() => handleInlineSubmit(qKey)}
              className="px-2.5 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              保存
            </button>
            <button
              onClick={() => setAddingQuadrant(null)}
              className="p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Cell Content */}
        {isDragTarget ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 pointer-events-none animate-in fade-in zoom-in-95 duration-100">
            <div className={`${meta.tagText} mb-2.5`}>
              <ArrowDownToLine className="w-9 h-9 stroke-[2]" />
            </div>
            <div className="text-sm font-bold text-slate-800 text-center leading-snug">
              松手设为
              <br />
              <span className={`${meta.tagText} font-extrabold text-sm`}>
                {meta.title}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-3">仅修改此任务</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {tasksList.length === 0 ? (
              <div className="h-full min-h-[180px] max-h-[220px] flex flex-col items-center justify-center text-center p-4 text-slate-400 select-none">
                <div className="text-xs font-semibold text-slate-500">暂无任务</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  拖入任务，或点击右上角「＋」添加
                </div>
              </div>
            ) : (
              tasksList.map((task) => renderTaskCard(task))
            )}
          </div>
        )}
      </div>
    );
  };

  const isUnclassifiedDragTarget = dragOverZone === 'unclassified';

  return (
    <div className="quadrant-workspace flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#f8fafc]">
      {/* 1. Top Global Toolbar spanning full width */}
      <div className="px-6 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center gap-4">
          {/* Category Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {selectedCategory === 'all'
                  ? '全部大类'
                  : rootCategories.find((c) => c.id === selectedCategory)?.title ||
                    '大类筛选'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showCategoryDropdown && (
              <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-40 space-y-0.5">
                <button
                  onClick={() => {
                    setSelectedCategory('all');
                    setShowCategoryDropdown(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg ${
                    selectedCategory === 'all'
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  全部大类
                </button>
                {rootCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setShowCategoryDropdown(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg ${
                      selectedCategory === cat.id
                        ? 'bg-blue-50 text-blue-600 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {cat.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Level Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowLevelDropdown(!showLevelDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>{levelFilterLabels[levelFilter]}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showLevelDropdown && (
              <div className="absolute left-0 top-full mt-1 w-36 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-40 space-y-0.5">
                {(['all', 'root_only', 'leaf_only'] as QuadrantLevelFilter[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setLevelFilter(mode);
                        setShowLevelDropdown(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg ${
                        levelFilter === mode
                          ? 'bg-blue-50 text-blue-600 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {levelFilterLabels[mode]}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Unclassified Drawer Toggle Button (PRD Section 3.3) */}
          <button
            onClick={() => setIsUnclassifiedCollapsed(!isUnclassifiedCollapsed)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border shadow-2xs ${
              !isUnclassifiedCollapsed
                ? 'bg-purple-50 border-purple-200 text-purple-700'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
            title="展开/收起未分类任务池"
          >
            <Inbox className="w-3.5 h-3.5 text-purple-600" />
            <span>未分类 ({unclassifiedTasks.length})</span>
          </button>

          {/* Completed Drawer Button */}
          {onOpenCompletedDrawer && (
            <button
              onClick={onOpenCompletedDrawer}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 rounded-lg transition-colors border border-slate-200/80 hover:border-blue-200"
              title="打开已完成任务抽屉"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-slate-500 hover:text-blue-600" />
              <span>已完成抽屉</span>
            </button>
          )}
        </div>

        {/* Global Stats bar */}
        <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            未分类: <strong className="text-slate-700">{unclassifiedTasks.length}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Q1: <strong className="text-slate-700">{q1Tasks.length}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Q2: <strong className="text-slate-700">{q2Tasks.length}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Q3: <strong className="text-slate-700">{q3Tasks.length}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            Q4: <strong className="text-slate-700">{q4Tasks.length}</strong>
          </span>
        </div>
      </div>

      {/* 2. Main Content Split: Left Unclassified Pool + Right 2x2 Quadrants */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Left: Unclassified Task Pool Slideout Drawer (PRD Section 3.3) */}
        {!isUnclassifiedCollapsed && (
          <aside
            onDragOver={(e) => handleDragOver(e, 'unclassified')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, null)}
            className={`w-[260px] absolute z-30 top-0 bottom-0 left-0 bg-white shadow-2xl border-r border-slate-200/90 flex flex-col transition-all select-none animate-in slide-in-from-left duration-200 ${
              isUnclassifiedDragTarget
                ? 'border-r-2 !border-r-purple-500 bg-purple-50/60 ring-2 ring-purple-100'
                : ''
            }`}
          >
            {/* Pool Header */}
            <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Inbox className="w-4 h-4 text-purple-600" />
                <span className="font-bold text-sm text-slate-800">
                  未分类任务池
                </span>
                <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200/60">
                  {unclassifiedTasks.length}
                </span>
              </div>

              <button
                onClick={() => setIsUnclassifiedCollapsed(true)}
                className="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
                title="收起任务池"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pool Body */}
            {isUnclassifiedDragTarget ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
                <ArrowDownToLine className="w-8 h-8 text-purple-600 mb-2 stroke-[2]" />
                <div className="text-xs font-bold text-purple-800">
                  松手移入未分类
                </div>
                <div className="text-[11px] text-purple-600 mt-0.5">
                  清除象限分类
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {unclassifiedTasks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <Check className="w-8 h-8 text-emerald-500 mb-2" />
                    <div className="text-xs font-semibold text-slate-600">
                      所有任务均已分类
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      从右侧拖入可清除象限
                    </div>
                  </div>
                ) : (
                  unclassifiedTasks.map((task) => renderTaskCard(task))
                )}
              </div>
            )}
          </aside>
        )}

        {/* Right: 2x2 Four Quadrants Matrix spanning remaining space */}
        <div className="quadrant-scroll flex-1 h-full min-h-0 p-4 overflow-hidden">
          <div
            className="quadrant-grid grid grid-cols-2 gap-3.5 h-full min-h-0"
            style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)' }}
          >
            {/* Top-Left: Q1 重要且紧急 */}
            {renderQuadrantCell('Q1', q1Tasks)}

            {/* Top-Right: Q2 重要不紧急 */}
            {renderQuadrantCell('Q2', q2Tasks)}

            {/* Bottom-Left: Q3 紧急不重要 */}
            {renderQuadrantCell('Q3', q3Tasks)}

            {/* Bottom-Right: Q4 不重要不紧急 */}
            {renderQuadrantCell('Q4', q4Tasks)}
          </div>
        </div>

        {/* Floating Hint Pill when dragging */}
        {draggingTaskId && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-full px-5 py-2 flex items-center gap-3 z-40 text-xs font-semibold text-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none pointer-events-none">
            <span>拖入象限完成分类</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500 font-normal">
              <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono text-slate-700 font-bold shadow-2xs">
                Esc
              </kbd>
              <span>取消</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
