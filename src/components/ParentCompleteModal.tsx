import React from 'react';
import { TaskNode } from '../types/todo';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

interface ParentCompleteModalProps {
  isOpen: boolean;
  parentTask: TaskNode | null;
  incompleteCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ParentCompleteModal: React.FC<ParentCompleteModalProps> = ({
  isOpen,
  parentTask,
  incompleteCount,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen || !parentTask) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-800">
              确认完成父项「{parentTask.title}」？
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              该任务下还有 <strong className="text-amber-600 font-bold">{incompleteCount}</strong> 项未完成的子任务。是否将它们一并标记为已完成？
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 transition-all"
          >
            全部完成
          </button>
        </div>
      </div>
    </div>
  );
};
