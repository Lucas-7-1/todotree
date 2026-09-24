import React, { useState, useRef, useLayoutEffect } from 'react';
import { CornerDownLeft, Plus, X } from 'lucide-react';

interface InlineTaskDraftRowProps {
  parentId: string;
  level: number;
  onSubmit: (parentId: string, title: string, continuous: boolean) => boolean;
  onCancel: () => void;
}

export const InlineTaskDraftRow: React.FC<InlineTaskDraftRowProps> = ({
  parentId,
  level,
  onSubmit,
  onCancel,
}) => {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isSavingRef = useRef(false);
  const isComposingRef = useRef(false);

  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
    const rafId = requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [parentId]);

  const handleCommit = (continuous: boolean) => {
    if (isSavingRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      if (!continuous) {
        onCancel();
      }
      return;
    }

    isSavingRef.current = true;
    if (!onSubmit(parentId, trimmed, continuous)) {
      isSavingRef.current = false;
      inputRef.current?.focus();
      return;
    }
    if (continuous) {
      setTitle('');
      isSavingRef.current = false;
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 10);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleCommit(true); // Continuous entry
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const handleBlur = () => {
    // If not actively saving via Enter, process blur
    if (!isSavingRef.current) {
      const trimmed = title.trim();
      if (trimmed) {
        handleCommit(false);
      } else {
        onCancel();
      }
    }
  };

  return (
    <div
      className="relative flex items-center py-1.5 px-3 rounded-lg text-sm bg-blue-50/40 border border-blue-200/90 shadow-2xs my-0.5 animate-in fade-in duration-100"
      style={{
        paddingLeft: `${Math.max(12, level * 26)}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left Connectors Line (when depth > 1) */}
      {level > 1 && (
        <div
          className="absolute border-l border-b border-blue-300 pointer-events-none rounded-bl-sm"
          style={{
            left: `${(level - 1) * 26 + 2}px`,
            top: 0,
            width: '14px',
            height: '50%',
          }}
        />
      )}

      <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-blue-500">
          <Plus className="w-3.5 h-3.5" />
        </span>

        {/* Checkbox placeholder */}
        <div className="w-4 h-4 rounded border border-dashed border-blue-400 bg-white flex-shrink-0" />

        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="输入子任务名称... (Enter 保存并继续，Esc 取消)"
          className="flex-1 px-2 py-0.5 text-sm bg-white border border-blue-400 rounded-md outline-none shadow-2xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 transition-all"
        />

        <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
          <span className="flex items-center gap-0.5 text-[11px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500">
            <CornerDownLeft className="w-3 h-3" />
            <span>保存</span>
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
            title="取消新增 (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
