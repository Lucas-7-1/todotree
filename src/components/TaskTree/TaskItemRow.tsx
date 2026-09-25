import React, { useState, useRef, useEffect } from 'react';
import {
  TaskNode,
  QuadrantType,
  DueType
} from '../../types/todo';
import {
  formatRelativeDate,
  calculateProgress,
  getAncestorPath,
  getDescendantTasks,
  getAncestorNodes,
  hasActiveTaskAncestor
} from '../../services/treeOperations';
import { createDragGhost, cleanupDragGhost } from '../../services/dragGhost';
import { formatRecurrenceSummary } from '../../services/recurrence';
import {
  ChevronRight,
  ChevronDown,
  Check,
  MoreHorizontal,
  Plus,
  Trash2,
  Copy,
  Calendar,
  Sparkles,
  GripVertical,
  Repeat,
  FileText
} from 'lucide-react';
import { TaskActionMenuPortal } from './TaskActionMenuPortal';
import { TaskQuadrantMenuPortal } from './TaskQuadrantMenuPortal';
import { MatchSnippet } from '../../services/filterEngine';

interface TaskItemRowProps {
  queuedCompletion?: boolean;
  onQueueCompletion?: (id: string) => void;
  selectionMode?: boolean;
  bulkSelected?: boolean;
  onLongPress?: (id: string) => void;
  onBulkSelect?: (id: string, range: boolean) => void;
  task: TaskNode;
  allTasks: TaskNode[];
  level: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  isSelected: boolean;
  onSelect: (task: TaskNode) => void;
  onToggleComplete: (task: TaskNode, outcomeNote?: string) => void;
  onArchiveCompleted?: (task: TaskNode) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onUpdateQuadrant: (id: string, quadrant: QuadrantType) => void;
  onUpdateDue: (id: string, dueType: DueType, dateStr: string | null) => void;
  onAddChild: (parentId: string) => void;
  onAddChildInline?: (parentId: string) => void;
  onDeleteTask: (task: TaskNode) => void;
  onDuplicateTask: (task: TaskNode, includeSubtree: boolean) => void;
  onTogglePlannedToday: (task: TaskNode) => void;
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
  onDragStateChange?: (isDragging: boolean, taskId: string | null) => void;
  isLastChild?: boolean;
  showCompleted?: boolean;
  pendingConfirmTaskId?: string | null;
  onSetPendingConfirmTaskId?: (id: string | null) => void;
  reducedMotion?: boolean;
  matchSnippet?: MatchSnippet;
  isContextOnly?: boolean;
}

export const TaskItemRow: React.FC<TaskItemRowProps> = ({
  onLongPress, queuedCompletion, onQueueCompletion, selectionMode = false, bulkSelected = false, onBulkSelect,
  task,
  allTasks,
  level,
  hasChildren,
  isExpanded,
  onToggleExpand,
  isSelected,
  onSelect,
  onToggleComplete,
  onArchiveCompleted,
  onUpdateTitle,
  onUpdateQuadrant,
  onUpdateDue,
  onAddChild,
  onAddChildInline,
  onDeleteTask,
  onDuplicateTask,
  onTogglePlannedToday,
  onMoveNode,
  onDragStateChange,
  isLastChild,
  showCompleted = false,
  pendingConfirmTaskId,
  onSetPendingConfirmTaskId,
  reducedMotion = false,
  matchSnippet,
  isContextOnly = false,
}) => {
  const touch = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const cancelTouch = () => clearTimeout(touch.current.timer);
  useEffect(() => () => cancelTouch(), []);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(task.title);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showQuadrantMenu, setShowQuadrantMenu] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<'before' | 'after' | 'inside' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localPendingConfirm, setLocalPendingConfirm] = useState(false);
  const [animPhase, setAnimPhase] = useState<'idle' | 'exiting'>('idle');

  const isPendingConfirm =
    queuedCompletion !== undefined ? queuedCompletion : pendingConfirmTaskId !== undefined ? pendingConfirmTaskId === task.id : localPendingConfirm;
  const leaveTimerRef = useRef<any>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const quadrantRef = useRef<HTMLButtonElement>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const isDone = task.status === 'done';
  const dateInfo = formatRelativeDate(task);
  const progress = calculateProgress(allTasks, task.id);

  // Descendants count for parent completion prompt
  const incompleteDescendants = onQueueCompletion ? [] : getDescendantTasks(allTasks, task.id).filter(
    (t) => !t.deleted_at && t.status === 'open'
  );
  const incompleteDescendantsCount = incompleteDescendants.length;

  // Check if completing this task will auto-close ancestors
  const willCloseAncestors: string[] = [];
  if (task.parent_id && !onQueueCompletion) {
    let currParentId: string | null = task.parent_id;
    const simulatedDone = new Set<string>([task.id, ...incompleteDescendants.map((d) => d.id)]);
    while (currParentId) {
      const parentNode = allTasks.find((t) => t.id === currParentId);
      if (!parentNode || parentNode.status === 'done' || parentNode.deleted_at) break;
      const siblings = allTasks.filter((t) => t.parent_id === currParentId && !t.deleted_at);
      const allSiblingsDone =
        siblings.length > 0 &&
        siblings.every((s) => s.status === 'done' || simulatedDone.has(s.id));
      if (allSiblingsDone) {
        willCloseAncestors.push(parentNode.title);
        simulatedDone.add(parentNode.id);
        currParentId = parentNode.parent_id;
      } else {
        break;
      }
    }
  }

  // Esc key cancels pending confirmation
  useEffect(() => {
    if (!isPendingConfirm || onQueueCompletion) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelPending();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPendingConfirm]);

  useEffect(() => {
    if (isEditingTitle && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSubmit = () => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdateTitle(task.id, trimmed);
    } else {
      setEditTitleValue(task.title);
    }
    setIsEditingTitle(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditTitleValue(task.title);
      setIsEditingTitle(false);
    }
  };

  // Drag start from dedicated grip handle
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    if (onDragStateChange) onDragStateChange(true, task.id);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'todotree-task',
        taskId: task.id,
        title: task.title,
        status: task.status,
      })
    );
    e.dataTransfer.effectAllowed = 'move';

    const ancestors = getAncestorPath(allTasks, task);
    const pathStr = ancestors.join(' / ');
    const ghost = createDragGhost(task.title, pathStr, dateInfo.label !== '-' ? dateInfo.label : null);
    ghostRef.current = ghost;
    e.dataTransfer.setDragImage(ghost, 12, 12);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    if (onDragStateChange) onDragStateChange(false, null);
    setDropIndicator(null);
    if (ghostRef.current) {
      cleanupDragGhost(ghostRef.current);
      ghostRef.current = null;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const height = rect.height;

    if (offsetY < height * 0.25) {
      setDropIndicator('before');
    } else if (offsetY > height * 0.75) {
      setDropIndicator('after');
    } else {
      setDropIndicator('inside');
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setDropIndicator(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rawData = e.dataTransfer.getData('application/json');
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!rawData) return;
    try {
      const data = JSON.parse(rawData);
      if (data.type === 'todotree-task' && data.taskId && data.taskId !== task.id) {
        onMoveNode(data.taskId, task.id, indicator || 'after');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Quadrant display configuration
  const quadrantBadges: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    Q1: { label: '重要且紧急', bg: 'bg-red-50 hover:bg-red-100', text: 'text-red-600', dot: 'bg-red-500' },
    Q2: { label: '重要不紧急', bg: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-600', dot: 'bg-blue-500' },
    Q3: { label: '紧急不重要', bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
    Q4: { label: '不重要不紧急', bg: 'bg-slate-100 hover:bg-slate-200', text: 'text-slate-600', dot: 'bg-slate-400' },
  };

  const currentQuadrant = task.quadrant ? quadrantBadges[task.quadrant] : null;

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const handleConfirmComplete = () => {
    if (onSetPendingConfirmTaskId) onSetPendingConfirmTaskId(null);
    else setLocalPendingConfirm(false);
    onToggleComplete(task);
  };
  const handleArchive = () => { onArchiveCompleted?.(task); };

  const handleCancelPending = () => {
    if (onSetPendingConfirmTaskId) {
      onSetPendingConfirmTaskId(null);
    } else {
      setLocalPendingConfirm(false);
    }
  };

  const triggerAddChild = () => {
    if (onAddChildInline) {
      onAddChildInline(task.id);
    } else {
      onAddChild(task.id);
    }
  };

  return (
    <div
      data-task-id={task.id}
      onTouchStart={e => {
        if (!onLongPress || (e.target as HTMLElement).closest('button,input,textarea')) return;
        cancelTouch(); const point = e.touches[0]; touch.current = { x: point.clientX, y: point.clientY, fired: false };
        touch.current.timer = setTimeout(() => { touch.current.fired = true; onLongPress(task.id); }, 500);
      }}
      onTouchMove={e => { const p = e.touches[0]; if (Math.abs(p.clientX-touch.current.x)+Math.abs(p.clientY-touch.current.y)>12) cancelTouch(); }}
      onTouchEnd={cancelTouch} onTouchCancel={cancelTouch}
      onClickCapture={e => { if (touch.current.fired) { e.preventDefault(); e.stopPropagation(); touch.current.fired = false; } }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={(e) => selectionMode ? !isContextOnly && onBulkSelect?.(task.id, e.shiftKey) : onSelect(task)}
      className={`group relative flex items-center justify-between py-2 px-3 rounded-lg text-sm border border-transparent cursor-pointer ${
        (selectionMode ? bulkSelected : isSelected)
          ? 'bg-blue-50/70 border-blue-200/80 shadow-xs'
          : isContextOnly
          ? 'opacity-60 bg-slate-50/40 hover:opacity-100'
          : 'hover:bg-slate-50/80 hover:border-slate-100'
      } ${
        isDragging ? 'opacity-40 bg-slate-50/60' : ''
      } ${
        isPendingConfirm ? 'opacity-90 bg-emerald-50/50 border-emerald-300' : ''
      } ${
        animPhase === 'exiting' ? 'opacity-0 -translate-y-1 pointer-events-none' : ''
      } ${
        dropIndicator === 'before' ? 'border-t-2 !border-t-blue-500' : ''
      } ${
        dropIndicator === 'after' ? 'border-b-2 !border-b-blue-500' : ''
      } ${
        dropIndicator === 'inside' ? 'bg-blue-100/50 !border-blue-400' : ''
      }`}
      style={{
        paddingLeft: `max(8px, calc(${level} * var(--tree-indent, 26px)))`,
        transition:
          animPhase === 'exiting'
            ? 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)'
            : 'background-color 150ms ease, border-color 150ms ease',
      }}
    >
      {/* Left Connectors Line (when depth > 1) */}
      {level > 1 && (
        <div
          className="absolute border-l border-b border-slate-200 pointer-events-none rounded-bl-sm"
          style={{
            left: `calc(${level-1} * var(--tree-indent, 26px) + 2px)`,
            top: 0,
            width: '14px',
            height: '50%',
          }}
        />
      )}

      {/* Task Info Column */}
      <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
        {/* Expand / Collapse Chevron */}
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(task.id);
              }}
              className="w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-slate-200 inline-block" />
          )}
        </div>

        {/* Dedicated Drag Handle */}
        <div
          draggable={!selectionMode}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 flex items-center justify-center text-slate-300 hover:text-blue-600 cursor-grab active:cursor-grabbing rounded transition-colors group-hover:opacity-100 opacity-40 flex-shrink-0"
          title="拖拽任务进行排序或分类"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {selectionMode && <input type="checkbox" aria-label={`选择 ${task.title}`} checked={bulkSelected} disabled={isContextOnly}
          onClick={e => { e.stopPropagation(); if (!isContextOnly) onBulkSelect?.(task.id, e.shiftKey); }} onChange={() => {}} className="w-4 h-4 accent-blue-600" />}
        {/* Complete Checkbox with 2-step confirmation preview */}
        <button
          disabled={selectionMode}
          onClick={(e) => {
            e.stopPropagation();
            if (onQueueCompletion && !isDone) { onQueueCompletion(task.id); return; }
            if (isDone) {
              onToggleComplete(task);
            } else {
              if (onSetPendingConfirmTaskId) {
                onSetPendingConfirmTaskId(isPendingConfirm ? null : task.id);
              } else {
                setLocalPendingConfirm(!localPendingConfirm);
              }
            }
          }}
          className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-all ${
            isDone
              ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
              : isPendingConfirm
              ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
              : 'border-slate-300 hover:border-blue-500 bg-white'
          }`}
          title={isDone ? '标记为未完成' : isPendingConfirm ? '取消勾选' : '勾选完成'}
        >
          {(isDone || isPendingConfirm) && <Check className="w-3 h-3 stroke-[3]" />}
        </button>

        {/* COMPACT Inline Confirmation Bar: Located IMMEDIATELY next to checkbox (<= 160px pointer distance) */}
        {isPendingConfirm && !onQueueCompletion && (
          <div
            className="flex items-center gap-1.5 mr-2 bg-emerald-50/95 border border-emerald-300 px-2 py-0.5 rounded-lg shadow-xs z-20 animate-in fade-in duration-100 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              ref={confirmBtnRef}
              disabled={animPhase !== 'idle'}
              onClick={handleConfirmComplete}
              className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white rounded-md transition-colors shadow-2xs whitespace-nowrap cursor-pointer"
            >
              {incompleteDescendantsCount > 0
                ? `完成本项及 ${incompleteDescendantsCount} 项子任务`
                : '确认完成'}
            </button>
            <button
              type="button"
              onClick={handleCancelPending}
              className="px-1.5 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-emerald-100/70 rounded-md transition-colors cursor-pointer"
            >
              取消
            </button>
            {willCloseAncestors.length > 0 && (
              <span className="text-[11px] text-emerald-800 font-medium pl-1 border-l border-emerald-300/80 whitespace-nowrap">
                一并关闭: {willCloseAncestors.join('、')}
              </span>
            )}
          </div>
        )}

        {/* Task Title (Inline Editable) */}
        {isEditingTitle ? (
          <input
            ref={editInputRef}
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1.5 py-0.5 text-sm bg-white border border-blue-500 rounded outline-none shadow-xs font-medium text-slate-800"
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditingTitle(true);
            }}
            className="flex items-center gap-2 truncate min-w-0 flex-1"
          >
            <span
              className={`strikethrough-animate font-medium text-sm transition-colors truncate ${
                isDone ? 'is-done text-slate-400' : isContextOnly ? 'text-slate-500' : 'text-slate-800'
              }`}
            >
              {task.title}
            </span>

            {/* Recurrence Badge */}
            {task.recurrence_rule && task.recurrence_rule.type !== 'none' && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 border border-blue-200/80 px-1.5 py-0.2 rounded font-medium flex-shrink-0"
                title={`重复规则: ${formatRecurrenceSummary(task.recurrence_rule)}`}
              >
                <Repeat className="w-3 h-3 stroke-[2.5]" />
                <span>{formatRecurrenceSummary(task.recurrence_rule)}</span>
              </span>
            )}

            {/* Background text indicator */}
            {task.background_text && task.background_text.trim() && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(task);
                }}
                className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 bg-indigo-50/80 border border-indigo-200/80 px-1.5 py-0.5 rounded font-medium hover:bg-indigo-100 transition-colors flex-shrink-0"
                title={`背景说明: ${task.background_text.slice(0, 100)}${task.background_text.length > 100 ? '...' : ''}`}
              >
                <FileText className="w-3 h-3 stroke-[2.2] text-indigo-500" />
                <span className="text-[10px]">背景</span>
              </span>
            )}

            {/* Note indicator */}
            {task.note && task.note.trim() && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(task);
                }}
                className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 rounded font-medium hover:bg-slate-200 transition-colors flex-shrink-0"
                title={`备注: ${task.note.slice(0, 100)}${task.note.length > 100 ? '...' : ''}`}
              >
                <span className="text-[10px]">备注</span>
              </span>
            )}

            {/* Search Match Snippet (PRD 1.2) */}
            {matchSnippet && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded max-w-[200px] truncate flex-shrink-0"
                title={`匹配${matchSnippet.field === 'background' ? '背景' : matchSnippet.field === 'note' ? '备注' : '成果'}: ${matchSnippet.text}`}
              >
                <span className="font-semibold text-[10px] text-amber-800">
                  {matchSnippet.field === 'background' ? '背景' : matchSnippet.field === 'note' ? '备注' : '成果'}:
                </span>
                <span className="truncate">{matchSnippet.text}</span>
              </span>
            )}

            {/* Dragging indicator */}
            {isDragging && (
              <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded font-medium flex-shrink-0">
                拖动中
              </span>
            )}

            {/* Subtask count and progress badge */}
            {hasChildren && progress.total > 0 && (
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded font-medium flex items-center gap-1 flex-shrink-0 ${
                  progress.isAllLeavesDone && !isDone
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500'
                }`}
                title={
                  progress.isAllLeavesDone && !isDone
                    ? '所有子任务均已完成，待确认父项'
                    : `子项进度: ${progress.completed}/${progress.total}`
                }
              >
                {progress.completed}/{progress.total}
              </span>
            )}

          </div>
        )}
        {isDone && !task.archived_at && onArchiveCompleted && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleArchive(); }}
            disabled={animPhase !== 'idle'}
            title="归档此已完成任务，其他子任务继续保留"
            className="flex-shrink-0 px-2 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200"
          >搞定</button>
        )}
        {/* Keep the action outside the truncated title, at every permitted depth. */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); triggerAddChild(); }}
          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded flex-shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
          title="原位添加子任务"
          aria-label={`为「${task.title}」添加子任务`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Meta Columns */}
      <div className="task-row-meta flex items-center gap-6 flex-shrink-0">
        {/* Deadline Column */}
        <div className="w-20 text-center">
          {dateInfo.label !== '-' ? (
            <span
              className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                dateInfo.isOverdue
                  ? 'bg-red-50 text-red-600 font-bold'
                  : dateInfo.isToday
                  ? 'bg-amber-50 text-amber-600 font-bold'
                  : 'text-slate-500'
              }`}
            >
              {dateInfo.label}
            </span>
          ) : (
            <span className="text-xs text-slate-300">-</span>
          )}
        </div>

        {/* Quadrant Column */}
        <div className="w-28 relative text-center">
          <button
            ref={quadrantRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowQuadrantMenu(!showQuadrantMenu);
            }}
            className={`text-xs px-2.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 transition-all ${
              currentQuadrant
                ? `${currentQuadrant.bg} ${currentQuadrant.text}`
                : 'text-slate-400 border border-dashed border-slate-300 hover:border-slate-400 hover:text-slate-600 bg-white'
            }`}
          >
            {currentQuadrant ? (
              <>
                <span className={`w-1.5 h-1.5 rounded-full ${currentQuadrant.dot}`} />
                <span>{currentQuadrant.label}</span>
              </>
            ) : (
              <span>未分类</span>
            )}
          </button>

          <TaskQuadrantMenuPortal
            isOpen={showQuadrantMenu}
            onClose={() => setShowQuadrantMenu(false)}
            triggerRef={quadrantRef}
            onSelectQuadrant={(q) => onUpdateQuadrant(task.id, q)}
          />
        </div>

        {/* More Actions Column */}
        <div className="w-6 relative text-right">
          <button
            ref={menuRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowMoreMenu(!showMoreMenu);
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            title="更多操作"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          <TaskActionMenuPortal
            isOpen={showMoreMenu}
            onClose={() => setShowMoreMenu(false)}
            triggerRef={menuRef}
            task={task}
            hasChildren={hasChildren}
            onEditTitle={() => setIsEditingTitle(true)}
            onAddChild={() => triggerAddChild()}
            onTogglePlannedToday={onTogglePlannedToday}
            onDuplicateTask={onDuplicateTask}
            onDeleteTask={onDeleteTask}
          />
        </div>
      </div>
    </div>
  );
};
