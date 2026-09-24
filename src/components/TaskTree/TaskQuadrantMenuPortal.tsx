import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { QuadrantType } from '../../types/todo';

interface TaskQuadrantMenuPortalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  onSelectQuadrant: (q: QuadrantType | null) => void;
}

export const TaskQuadrantMenuPortal: React.FC<TaskQuadrantMenuPortalProps> = ({
  isOpen,
  onClose,
  triggerRef,
  onSelectQuadrant,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 150;
      const menuHeight = 190;
      const margin = 12;

      let top = rect.bottom + 4;
      if (rect.bottom + menuHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - menuHeight - 4);
      }

      let left = rect.left;
      if (left < margin) {
        left = margin;
      }
      if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
      }

      setCoords({ top, left });
    };

    updatePosition();
  }, [isOpen, triggerRef]);

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

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[9999] w-38 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-300/40 p-1.5 text-left space-y-0.5 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        minWidth: '150px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] text-slate-400 font-semibold px-2 py-1">选择象限</div>
      <button
        type="button"
        onClick={() => {
          onSelectQuadrant('Q1');
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span>重要且紧急 (Q1)</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectQuadrant('Q2');
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span>重要不紧急 (Q2)</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectQuadrant('Q3');
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span>紧急不重要 (Q3)</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectQuadrant('Q4');
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-slate-400" />
        <span>不重要不紧急 (Q4)</span>
      </button>
      <div className="border-t border-slate-100 my-1" />
      <button
        type="button"
        onClick={() => {
          onSelectQuadrant(null);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full border border-slate-300" />
        <span>清除分类 (未分类)</span>
      </button>
    </div>,
    document.body
  );
};
