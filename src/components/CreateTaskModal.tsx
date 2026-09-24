import React, { useState, useRef, useEffect } from 'react';
import { TaskNode, QuadrantType, DueType, RecurrenceType, RecurrenceRule } from '../types/todo';
import { getAncestorPath } from '../services/treeOperations';
import {
  X,
  Plus,
  FolderTree,
  Calendar,
  Grid2X2,
  Repeat,
  Lock,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: TaskNode[];
  initialParentId?: string | null;
  isTabOwner: boolean;
  onTakeOverLock: () => void;
  onAddTask: (
    title: string,
    parentId: string | null,
    dueType?: DueType,
    dueDate?: string | null,
    quadrant?: QuadrantType,
    recurrenceRule?: RecurrenceRule | null,
    note?: string
  ) => void;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  tasks,
  initialParentId = null,
  isTabOwner,
  onTakeOverLock,
  onAddTask,
}) => {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [quadrant, setQuadrant] = useState<QuadrantType>(null);
  const [dueType, setDueType] = useState<DueType>('none');
  const [dueDate, setDueDate] = useState<string>('');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setParentId(initialParentId || null);
      setTitle('');
      setNote('');
      setQuadrant(null);
      setDueType('none');
      setDueDate('');
      setRecurrenceType('none');
      setErrorMessage(null);

      setTimeout(() => {
        if (titleInputRef.current) {
          titleInputRef.current.focus();
        }
      }, 60);
    }
  }, [isOpen, initialParentId]);

  useEffect(() => {
    if (isTabOwner && isOpen) {
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 60);
    }
  }, [isTabOwner, isOpen]);

  if (!isOpen) return null;

  const candidateParents = tasks.filter((t) => !t.deleted_at && t.status === 'open');

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    if (!isTabOwner) {
      setErrorMessage('当前窗口为只读，请先点击上方“接管并新建”以获取编辑权限');
      return;
    }

    const trimmed = title.trim();
    if (!trimmed) {
      setErrorMessage('请输入任务标题');
      titleInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let recRule: RecurrenceRule | null = null;
      if (recurrenceType !== 'none') {
        recRule = {
          id: 'rule_' + Date.now(),
          type: recurrenceType,
          interval: 1,
          start_date: dueDate || new Date().toISOString().split('T')[0],
        };
      }

      onAddTask(
        trimmed,
        parentId,
        dueType,
        dueType !== 'none' ? dueDate : null,
        quadrant,
        recRule,
        note.trim() || undefined
      );

      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || '创建任务失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const setDueShortcut = (type: 'today' | 'tomorrow' | 'next_mon' | 'none') => {
    const today = new Date();
    if (type === 'none') {
      setDueType('none');
      setDueDate('');
    } else if (type === 'today') {
      setDueType('date');
      setDueDate(today.toISOString().split('T')[0]);
    } else if (type === 'tomorrow') {
      const tomorrow = new Date(today.getTime() + 86400000);
      setDueType('date');
      setDueDate(tomorrow.toISOString().split('T')[0]);
    } else if (type === 'next_mon') {
      const day = today.getDay();
      const diff = day === 0 ? 1 : 8 - day;
      const nextMon = new Date(today.getTime() + diff * 86400000);
      setDueType('date');
      setDueDate(nextMon.toISOString().split('T')[0]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">新建任务</h3>
              <p className="text-[11px] text-slate-400">支持快速设定层级归属、优先级与周期</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Read-Only Tab Takeover Banner (PRD Section 8.2) */}
        {!isTabOwner && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-800">
              <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>当前窗口为只读，接管后可新建</span>
            </div>
            <button
              type="button"
              onClick={onTakeOverLock}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-xs flex items-center gap-1 shadow-xs transition-colors flex-shrink-0"
            >
              <span>接管并新建</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMessage && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Title Input */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              任务标题 <span className="text-red-500">*</span>
            </label>
            <input
              ref={titleInputRef}
              type="text"
              required
              disabled={!isTabOwner || isSubmitting}
              placeholder="例如：整理供应商报价清单..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all disabled:opacity-60"
            />
          </div>

          {/* Parent Task Selector */}
          <div>
            <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
              <FolderTree className="w-3.5 h-3.5 text-slate-500" />
              <span>所属项目 / 父任务 (可选)</span>
            </label>
            <select
              disabled={!isTabOwner || isSubmitting}
              value={parentId || ''}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:bg-white focus:border-blue-500 outline-none transition-all disabled:opacity-60"
            >
              <option value="">(根任务 / 顶级大类)</option>
              {candidateParents.map((p) => {
                const ancestors = getAncestorPath(tasks, p);
                const pathStr = ancestors.length > 0 ? ancestors.join(' / ') + ' / ' : '';
                return (
                  <option key={p.id} value={p.id}>
                    {pathStr}{p.title}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Quadrant Selector */}
          <div>
            <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
              <Grid2X2 className="w-3.5 h-3.5 text-slate-500" />
              <span>四象限优先级 (可选)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setQuadrant(quadrant === 'Q1' ? null : 'Q1')}
                className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all ${
                  quadrant === 'Q1'
                    ? 'border-red-500 bg-red-50 text-red-700 font-bold ring-1 ring-red-400'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>Q1 重要且紧急</span>
                <span className="w-2 h-2 rounded-full bg-red-500" />
              </button>

              <button
                type="button"
                onClick={() => setQuadrant(quadrant === 'Q2' ? null : 'Q2')}
                className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all ${
                  quadrant === 'Q2'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>Q2 重要不紧急</span>
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              </button>

              <button
                type="button"
                onClick={() => setQuadrant(quadrant === 'Q3' ? null : 'Q3')}
                className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all ${
                  quadrant === 'Q3'
                    ? 'border-amber-500 bg-amber-50 text-amber-700 font-bold ring-1 ring-amber-400'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>Q3 紧急不重要</span>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
              </button>

              <button
                type="button"
                onClick={() => setQuadrant(quadrant === 'Q4' ? null : 'Q4')}
                className={`px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all ${
                  quadrant === 'Q4'
                    ? 'border-slate-500 bg-slate-100 text-slate-800 font-bold ring-1 ring-slate-400'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>Q4 不重要不紧急</span>
                <span className="w-2 h-2 rounded-full bg-slate-400" />
              </button>
            </div>
          </div>

          {/* Due Date & Shortcuts */}
          <div>
            <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>截止时间 (可选)</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setDueShortcut('today')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-600 hover:text-blue-600 transition-colors"
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => setDueShortcut('tomorrow')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-600 hover:text-blue-600 transition-colors"
              >
                明天
              </button>
              <button
                type="button"
                onClick={() => setDueShortcut('next_mon')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-600 hover:text-blue-600 transition-colors"
              >
                下周一
              </button>
              <button
                type="button"
                onClick={() => setDueShortcut('none')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                清除
              </button>
            </div>
            <input
              type="date"
              disabled={!isTabOwner || isSubmitting}
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setDueType(e.target.value ? 'date' : 'none');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:bg-white focus:border-blue-500 outline-none transition-all disabled:opacity-60"
            />
          </div>

          {/* Recurrence Rule */}
          <div>
            <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
              <Repeat className="w-3.5 h-3.5 text-slate-500" />
              <span>周期重复 (可选)</span>
            </label>
            <div className="flex items-center gap-2">
              {(['none', 'daily', 'weekly', 'monthly'] as RecurrenceType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setRecurrenceType(type)}
                  className={`flex-1 py-1.5 rounded-lg border text-center transition-all ${
                    recurrenceType === type
                      ? 'border-blue-500 bg-blue-50 text-blue-600 font-semibold'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {type === 'none' ? '不重复' : type === 'daily' ? '每天' : type === 'weekly' ? '每周' : '每月'}
                </button>
              ))}
            </div>
          </div>

          {/* Remarks/Note */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              详细备注 (可选)
            </label>
            <textarea
              rows={2}
              disabled={!isTabOwner || isSubmitting}
              placeholder="添加背景信息、交付标准或注意事项..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs focus:bg-white focus:border-blue-500 outline-none transition-all resize-none disabled:opacity-60"
            />
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            按 <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">Ctrl+Enter</kbd> 快速保存
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!isTabOwner || isSubmitting || !title.trim()}
              onClick={() => handleSubmit()}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl shadow-sm shadow-blue-500/20 transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? '保存中...' : '创建任务'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
