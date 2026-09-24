import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'complete' | 'info' | 'error';
  title: string;
  canUndo?: boolean;
  onUndo?: () => void;
  onViewCompleted?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    if (!toast) return;
    const duration = toast.duration ?? (toast.canUndo ? 8000 : 3500);
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-8 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200 select-none">
      {toast.type === 'complete' && (
        <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}
      {toast.type === 'error' && (
        <div className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-4 h-4" />
        </div>
      )}
      {toast.type === 'info' && (
        <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}

      <span className="text-xs font-semibold text-slate-800">
        {toast.title}
      </span>

      {toast.canUndo && toast.onUndo && (
        <button
          onClick={() => {
            toast.onUndo?.();
            onClose();
          }}
          className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 ml-1 transition-colors"
        >
          撤销
        </button>
      )}

      {toast.actionLabel && toast.onAction && (
        <button
          onClick={() => {
            toast.onAction?.();
            onClose();
          }}
          className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 ml-1 transition-colors"
        >
          {toast.actionLabel}
        </button>
      )}

      {toast.onViewCompleted && (
        <button
          onClick={() => {
            toast.onViewCompleted?.();
            onClose();
          }}
          className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline px-1 py-0.5 ml-1 transition-colors"
        >
          查看已完成
        </button>
      )}

      <button
        onClick={onClose}
        className="w-5 h-5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center ml-2 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
