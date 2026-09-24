import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskNode } from '../../types/todo';
import {
  Edit3,
  Plus,
  Calendar,
  Copy,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { isTaskDueToday, isTaskOverdue } from '../../services/treeOperations';
import { getTodayDateString } from '../../services/seedData';

interface TaskActionMenuPortalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  task: TaskNode;
  hasChildren: boolean;
  onEditTitle: () => void;
  onAddChild: (parentId: string) => void;
  onTogglePlannedToday: (task: TaskNode) => void;
  onDuplicateTask: (task: TaskNode, includeSubtree: boolean) => void;
  onDeleteTask: (task: TaskNode) => void;
}

export const TaskActionMenuPortal: React.FC<TaskActionMenuPortalProps> = ({
  isOpen,
  onClose,
  triggerRef,
  task,
  hasChildren,
  onEditTitle,
  onAddChild,
  onTogglePlannedToday,
  onDuplicateTask,
  onDeleteTask,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 184;
      const menuHeight = hasChildren ? 245 : 205;
      const margin = 12;

      let top = rect.bottom + 4;
      if (rect.bottom + menuHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - menuHeight - 4);
      }

      let left = rect.right - menuWidth;
      if (left < margin) {
        left = margin;
      }
      if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
      }

      setCoords({ top, left });
    };

    updatePosition();
  }, [isOpen, triggerRef, hasChildren]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    const handleScrollOrDrag = () => {
      onClose();
    };

    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        if (triggerRef.current && triggerRef.current.contains(e.target as Node)) {
          return;
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScrollOrDrag, true);
    window.addEventListener('dragstart', handleScrollOrDrag, true);
    window.addEventListener('resize', handleScrollOrDrag);
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleScrollOrDrag, true);
      window.removeEventListener('dragstart', handleScrollOrDrag, true);
      window.removeEventListener('resize', handleScrollOrDrag);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen || !coords) return null;

  const todayStr = getTodayDateString(0);
  const isDueOrOverdue = isTaskDueToday(task) || isTaskOverdue(task);
  const isManuallyPlanned = task.planned_date === todayStr;

  let todayLabel = '加入今天';
  if (isManuallyPlanned && !isDueOrOverdue) {
    todayLabel = '从今天移出';
  } else if (isManuallyPlanned && isDueOrOverdue) {
    todayLabel = '取消今日手动安排';
  } else if (!isManuallyPlanned && isDueOrOverdue) {
    todayLabel = '主动加入今天';
  } else {
    todayLabel = '加入今天';
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="任务操作菜单"
      className="fixed z-[9999] w-46 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-300/40 p-1 text-left space-y-0.5 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        minWidth: '180px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onEditTitle();
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors"
      >
        <Edit3 className="w-3.5 h-3.5 text-slate-400" />
        <span>修改标题</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onAddChild(task.id);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors"
      >
        <Plus className="w-3.5 h-3.5 text-slate-400" />
        <span>添加子任务</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onTogglePlannedToday(task);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors"
      >
        <Calendar className="w-3.5 h-3.5 text-slate-400" />
        <span>{todayLabel}</span>
      </button>

      <div className="border-t border-slate-100 my-1" />

      <button
        type="button"
        onClick={() => {
          onDuplicateTask(task, false);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors"
      >
        <Copy className="w-3.5 h-3.5 text-slate-400" />
        <span>复制当前节点</span>
      </button>

      {hasChildren && (
        <button
          type="button"
          onClick={() => {
            onDuplicateTask(task, true);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-slate-400" />
          <span>复制整棵子树</span>
        </button>
      )}

      <div className="border-t border-slate-100 my-1" />

      <button
        type="button"
        onClick={() => {
          onDeleteTask(task);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
        <span>移入回收站</span>
      </button>
    </div>,
    document.body
  );
};
