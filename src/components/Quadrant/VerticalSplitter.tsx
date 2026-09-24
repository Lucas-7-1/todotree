import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface VerticalSplitterProps {
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  onResize: (newWidth: number) => void;
  onResizeEnd: (finalWidth: number) => void;
  onResetDefault: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

export const VerticalSplitter: React.FC<VerticalSplitterProps> = ({
  currentWidth,
  minWidth,
  maxWidth,
  defaultWidth,
  onResize,
  onResizeEnd,
  onResetDefault,
  onDragStateChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(currentWidth);
  const rafIdRef = useRef<number | null>(null);
  const latestWidthRef = useRef(currentWidth);

  latestWidthRef.current = currentWidth;

  const clampWidth = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(w))),
    [minWidth, maxWidth]
  );

  const cleanupDrag = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
    if (onDragStateChange) onDragStateChange(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onDragStateChange]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    isDraggingRef.current = true;
    setIsDragging(true);
    if (onDragStateChange) onDragStateChange(true);
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = e.clientX;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const deltaX = clientX - startXRef.current;
      // Moving left increases the panel width (since panel is docked on the right)
      const targetWidth = clampWidth(startWidthRef.current - deltaX);
      onResize(targetWidth);
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    cleanupDrag();
    onResizeEnd(latestWidthRef.current);
  };

  const handlePointerCancel = () => {
    if (!isDraggingRef.current) return;
    cleanupDrag();
    onResizeEnd(latestWidthRef.current);
  };

  // Esc cancel and blur handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDraggingRef.current && e.key === 'Escape') {
        e.preventDefault();
        const originalWidth = startWidthRef.current;
        cleanupDrag();
        onResize(originalWidth);
        onResizeEnd(originalWidth);
      }
    };

    const handleBlur = () => {
      if (isDraggingRef.current) {
        cleanupDrag();
        onResizeEnd(latestWidthRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [cleanupDrag, onResize, onResizeEnd]);

  // Keyboard navigation on the splitter itself
  const handleKeyDownOnSplitter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      // ArrowLeft increases panel width; ArrowRight decreases
      const delta = e.key === 'ArrowLeft' ? step : -step;
      const targetWidth = clampWidth(currentWidth + delta);
      onResize(targetWidth);
      onResizeEnd(targetWidth);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const target = clampWidth(minWidth);
      onResize(target);
      onResizeEnd(target);
    } else if (e.key === 'End') {
      e.preventDefault();
      const target = clampWidth(maxWidth);
      onResize(target);
      onResizeEnd(target);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onResetDefault();
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="调整四象限预览宽度"
      aria-valuenow={Math.round(currentWidth)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResetDefault();
      }}
      onKeyDown={handleKeyDownOnSplitter}
      className={`w-2 flex-shrink-0 relative group cursor-col-resize h-screen select-none z-30 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-400 ${
        isDragging ? 'bg-blue-100/80' : 'hover:bg-slate-200/50'
      }`}
      title="拖动调整宽度，双击恢复默认，左右方向键微调"
    >
      {/* 12px hit zone (PRD Section 5: 实际命中区域可扩至 12px，但不遮挡邻近按钮) */}
      <div className="absolute inset-y-0 -left-0.5 -right-0.5 pointer-events-none" />

      {/* Clear short handle in center (PRD Section 5: 分隔条中部提供清晰可见的短手柄) */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full transition-all pointer-events-none ${
          isDragging
            ? 'bg-blue-600 scale-y-110 shadow-xs'
            : 'bg-slate-300 group-hover:bg-blue-500 group-hover:h-9'
        }`}
      />
    </div>
  );
};
