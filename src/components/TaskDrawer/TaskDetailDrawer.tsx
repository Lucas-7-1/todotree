import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TaskNode,
  QuadrantType,
  DueType,
  RecurrenceType,
  RecurrenceRule
} from '../../types/todo';
import {
  getAncestorPath,
  canMoveSubtree,
  formatRelativeDate,
  getNodeDepth
} from '../../services/treeOperations';
import { getTodayDateString } from '../../services/seedData';
import { formatRecurrenceSummary } from '../../services/recurrence';
import {
  X,
  Calendar,
  Tag,
  FolderTree,
  FileText,
  Copy,
  Trash2,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  Repeat,
  Check,
  Loader2,
  BookOpen
} from 'lucide-react';

interface TaskDetailDrawerProps {
  task: TaskNode | null;
  allTasks: TaskNode[];
  onClose: () => void;
  onUpdateTask: (id: string, updates: Partial<TaskNode>, updateMode?: 'single' | 'series') => void;
  onDeleteTask: (task: TaskNode) => void;
  onDuplicateTask: (task: TaskNode, includeSubtree: boolean) => void;
  onShowErrorToast: (msg: string) => void;
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  allTasks,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onDuplicateTask,
  onShowErrorToast,
}) => {
  if (!task) return null;

  const [title, setTitle] = useState(task.title);
  const [backgroundText, setBackgroundText] = useState(task.background_text || '');
  const [outcomeNote, setOutcomeNote] = useState(task.outcome_note || '');
  const [note, setNote] = useState(task.note);
  const [dueType, setDueType] = useState<DueType>(task.due_type);
  const [dueDate, setDueDate] = useState<string | null>(task.due_date);
  const [quadrant, setQuadrant] = useState<QuadrantType>(task.quadrant);
  const [parentId, setParentId] = useState<string | null>(task.parent_id);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(
    task.recurrence_rule || null
  );
  const [updateMode, setUpdateMode] = useState<'single' | 'series'>('single');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  const pendingUpdatesRef = useRef<Partial<TaskNode>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushUpdates = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (Object.keys(pendingUpdatesRef.current).length > 0 && task) {
      onUpdateTask(task.id, pendingUpdatesRef.current, updateMode);
      pendingUpdatesRef.current = {};
      setSaveStatus('saved');
    }
  }, [task, onUpdateTask, updateMode]);

  const scheduleUpdate = useCallback(
    (updates: Partial<TaskNode>) => {
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
      setSaveStatus('saving');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        flushUpdates();
      }, 500);
    },
    [flushUpdates]
  );

  useEffect(() => {
    // Flush updates for previous task if switching
    flushUpdates();
    setTitle(task.title);
    setBackgroundText(task.background_text || '');
    setOutcomeNote(task.outcome_note || '');
    setNote(task.note);
    setDueType(task.due_type);
    setDueDate(task.due_date);
    setQuadrant(task.quadrant);
    setParentId(task.parent_id);
    setRecurrenceRule(task.recurrence_rule || null);
    setUpdateMode('single');
    setSaveStatus('saved');
    pendingUpdatesRef.current = {};
  }, [task.id]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    flushUpdates();
    onClose();
  };

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      scheduleUpdate({ title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleBackgroundChange = (val: string) => {
    setBackgroundText(val);
    scheduleUpdate({ background_text: val });
  };

  const handleBackgroundBlur = () => {
    flushUpdates();
  };

  const handleOutcomeNoteChange = (val: string) => {
    setOutcomeNote(val);
    scheduleUpdate({ outcome_note: val });
  };

  const handleOutcomeNoteBlur = () => {
    flushUpdates();
  };

  const handleNoteChange = (val: string) => {
    setNote(val);
    scheduleUpdate({ note: val });
  };

  const handleNoteBlur = () => {
    flushUpdates();
  };

  const handleQuadrantChange = (newQ: QuadrantType) => {
    setQuadrant(newQ);
    flushUpdates();
    onUpdateTask(task.id, { quadrant: newQ });
  };

  const handleDateChange = (dateStr: string | null) => {
    const newType = dateStr ? 'date' : 'none';
    setDueType(newType);
    setDueDate(dateStr);
    flushUpdates();
    onUpdateTask(task.id, { due_type: newType, due_date: dateStr });
  };

  const handleParentChange = (newParentId: string | null) => {
    if (newParentId === task.parent_id) return;
    const check = canMoveSubtree(allTasks, task, newParentId);
    if (!check.allowed) {
      onShowErrorToast(check.reason || '无法移动至此父级');
      setParentId(task.parent_id);
      return;
    }
    setParentId(newParentId);
    flushUpdates();
    onUpdateTask(task.id, { parent_id: newParentId });
  };

  const handleTogglePlannedToday = () => {
    const todayStr = getTodayDateString(0);
    const newPlanned = task.planned_date ? null : todayStr;
    flushUpdates();
    onUpdateTask(task.id, { planned_date: newPlanned });
  };

  const currentDepth = getNodeDepth(allTasks, task);
  const dateInfo = formatRelativeDate(task);
  const isDone = task.status === 'done';

  // Candidate parents (excluding self and all descendants)
  const candidateParents = allTasks.filter(t => !t.deleted_at && t.id !== task.id);

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col justify-between select-none animate-in slide-in-from-right duration-200">
      {/* Top Header */}
      <div>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
              }`}
            >
              {isDone ? '已完成' : '进行中'}
            </span>
            <span className="text-xs text-slate-400">第 {currentDepth} 层级</span>

            {/* Save Status Indicator (A34) */}
            {saveStatus === 'saving' ? (
              <span className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium animate-in fade-in">
                <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                <span>保存中...</span>
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium animate-in fade-in">
                <Check className="w-3 h-3 text-emerald-500" />
                <span>已保存</span>
              </span>
            )}
          </div>

          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
            title="关闭 (自动保存)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-140px)]">
          {/* Title */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 block">
              任务标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              maxLength={200}
              className="w-full text-base font-bold text-slate-800 border-b border-transparent focus:border-blue-500 pb-1 outline-none transition-colors"
            />
          </div>

          {/* Parent Node Picker */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5" />
              <span>所属父级</span>
            </label>
            <select
              value={parentId || ''}
              onChange={(e) => handleParentChange(e.target.value ? e.target.value : null)}
              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">(根节点 / 大类)</option>
              {candidateParents.map(p => {
                const ancestors = getAncestorPath(allTasks, p);
                const pathStr = ancestors.length > 0 ? `${ancestors.join(' / ')} / ` : '';
                return (
                  <option key={p.id} value={p.id}>
                    {pathStr}{p.title}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Deadline Picker */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>截止时间</span>
              </span>
              {dueDate && (
                <button
                  type="button"
                  onClick={() => handleDateChange(null)}
                  className="text-rose-500 hover:underline"
                >
                  清除
                </button>
              )}
            </label>

            <div className="flex items-center gap-2 mb-2">
              <input
                type="date"
                value={dueDate || ''}
                onChange={(e) => handleDateChange(e.target.value || null)}
                className="flex-1 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-blue-500"
              />
              {dateInfo.label !== '-' && (
                <span
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-bold ${
                    dateInfo.isOverdue
                      ? 'bg-red-50 text-red-600'
                      : dateInfo.isToday
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {dateInfo.label}
                </span>
              )}
            </div>

            {/* Quick date buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDateChange(getTodayDateString(0))}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors"
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => handleDateChange(getTodayDateString(1))}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors"
              >
                明天
              </button>
              <button
                type="button"
                onClick={() => handleDateChange(getTodayDateString(7))}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors"
              >
                7天后
              </button>
            </div>
          </div>

          {/* Recurrence Settings */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Repeat className="w-3.5 h-3.5" />
                <span>重复规则</span>
              </span>
              {recurrenceRule && recurrenceRule.type !== 'none' && (
                <span className="text-[11px] text-blue-600 font-medium">
                  {formatRecurrenceSummary(recurrenceRule)}
                </span>
              )}
            </label>

            {/* Type selector */}
            <div className="grid grid-cols-4 gap-1.5 mb-2.5">
              {(['none', 'daily', 'weekly', 'monthly'] as RecurrenceType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (t === 'none') {
                      setRecurrenceRule(null);
                      onUpdateTask(task.id, { recurrence_rule: null, recurrence_rule_id: null }, updateMode);
                    } else {
                      const newRule: RecurrenceRule = {
                        id: recurrenceRule?.id || 'rule-' + Date.now(),
                        type: t,
                        interval: 1,
                        days_of_week: recurrenceRule?.days_of_week || [5],
                        day_of_month: recurrenceRule?.day_of_month || 25,
                        start_date: recurrenceRule?.start_date || task.due_date || getTodayDateString(0),
                        end_date: recurrenceRule?.end_date || null,
                        paused: false,
                      };
                      setRecurrenceRule(newRule);
                      onUpdateTask(task.id, { recurrence_rule: newRule, recurrence_rule_id: newRule.id }, updateMode);
                    }
                  }}
                  className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    (recurrenceRule?.type || 'none') === t
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {t === 'none' ? '不重复' : t === 'daily' ? '每天' : t === 'weekly' ? '每周' : '每月'}
                </button>
              ))}
            </div>

            {/* Detailed sub-options if recurring */}
            {recurrenceRule && recurrenceRule.type !== 'none' && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3 text-xs">
                {/* Weekly detail */}
                {recurrenceRule.type === 'weekly' && (
                  <div>
                    <span className="text-[11px] text-slate-500 font-medium block mb-1.5">选择星期几</span>
                    <div className="flex gap-1 justify-between">
                      {[
                        { day: 1, label: '一' },
                        { day: 2, label: '二' },
                        { day: 3, label: '三' },
                        { day: 4, label: '四' },
                        { day: 5, label: '五' },
                        { day: 6, label: '六' },
                        { day: 7, label: '日' },
                      ].map(({ day, label }) => {
                        const currentDays = recurrenceRule.days_of_week || [5];
                        const isSelected = currentDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              let nextDays = isSelected
                                ? currentDays.filter((d) => d !== day)
                                : [...currentDays, day].sort();
                              if (nextDays.length === 0) nextDays = [day];
                              const updated = { ...recurrenceRule, days_of_week: nextDays };
                              setRecurrenceRule(updated);
                              onUpdateTask(task.id, { recurrence_rule: updated }, updateMode);
                            }}
                            className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                              isSelected
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 hover:bg-slate-100 text-slate-700'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monthly detail */}
                {recurrenceRule.type === 'monthly' && (
                  <div>
                    <span className="text-[11px] text-slate-500 font-medium block mb-1">选择每月几号</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">每月</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={recurrenceRule.day_of_month || 1}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(31, parseInt(e.target.value) || 1));
                          const updated = { ...recurrenceRule, day_of_month: val };
                          setRecurrenceRule(updated);
                          onUpdateTask(task.id, { recurrence_rule: updated }, updateMode);
                        }}
                        className="w-16 p-1 text-xs border border-slate-200 bg-white rounded text-center outline-none focus:border-blue-500"
                      />
                      <span className="text-slate-600">日</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      注：若当月无此日（如2月30日），默认在当月最后一天执行。
                    </span>
                  </div>
                )}

                {/* Date range */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 text-[11px]">
                  <div>
                    <label className="text-slate-500 block mb-1">开始日期</label>
                    <input
                      type="date"
                      value={recurrenceRule.start_date || ''}
                      onChange={(e) => {
                        const updated = { ...recurrenceRule, start_date: e.target.value };
                        setRecurrenceRule(updated);
                        onUpdateTask(task.id, { recurrence_rule: updated }, updateMode);
                      }}
                      className="w-full p-1 bg-white border border-slate-200 rounded outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500 block mb-1">结束日期 (可选)</label>
                    <input
                      type="date"
                      value={recurrenceRule.end_date || ''}
                      onChange={(e) => {
                        const updated = { ...recurrenceRule, end_date: e.target.value || null };
                        setRecurrenceRule(updated);
                        onUpdateTask(task.id, { recurrence_rule: updated }, updateMode);
                      }}
                      className="w-full p-1 bg-white border border-slate-200 rounded outline-none"
                    />
                  </div>
                </div>

                {/* Pause toggle */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                  <span className="text-slate-600">暂停此重复任务</span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...recurrenceRule, paused: !recurrenceRule.paused };
                      setRecurrenceRule(updated);
                      onUpdateTask(task.id, { recurrence_rule: updated }, updateMode);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      recurrenceRule.paused
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                    }`}
                  >
                    {recurrenceRule.paused ? '已暂停 (点击恢复)' : '暂停重复'}
                  </button>
                </div>

                {/* Scope selector: Edit current vs Edit series */}
                {task.recurrence_rule_id && (
                  <div className="pt-2 border-t border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium block mb-1">修改应用范围</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setUpdateMode('single')}
                        className={`flex-1 py-1 text-xs rounded-md font-medium border transition-colors ${
                          updateMode === 'single'
                            ? 'bg-blue-50 border-blue-500 text-blue-700 font-semibold'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        仅修改本次
                      </button>
                      <button
                        type="button"
                        onClick={() => setUpdateMode('series')}
                        className={`flex-1 py-1 text-xs rounded-md font-medium border transition-colors ${
                          updateMode === 'series'
                            ? 'bg-blue-50 border-blue-500 text-blue-700 font-semibold'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        修改本次及以后
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quadrant Picker */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              <span>四象限归属</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuadrantChange('Q1')}
                className={`flex items-center gap-2 p-2 rounded-xl text-xs font-semibold border transition-all ${
                  quadrant === 'Q1'
                    ? 'bg-red-50 border-red-300 text-red-600 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span>重要且紧急 (Q1)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuadrantChange('Q2')}
                className={`flex items-center gap-2 p-2 rounded-xl text-xs font-semibold border transition-all ${
                  quadrant === 'Q2'
                    ? 'bg-blue-50 border-blue-300 text-blue-600 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span>重要不紧急 (Q2)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuadrantChange('Q3')}
                className={`flex items-center gap-2 p-2 rounded-xl text-xs font-semibold border transition-all ${
                  quadrant === 'Q3'
                    ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span>紧急不重要 (Q3)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuadrantChange('Q4')}
                className={`flex items-center gap-2 p-2 rounded-xl text-xs font-semibold border transition-all ${
                  quadrant === 'Q4'
                    ? 'bg-slate-100 border-slate-300 text-slate-700 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                <span>不重要不紧急 (Q4)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleQuadrantChange(null)}
              className={`w-full mt-2 py-1.5 rounded-lg text-xs font-medium border text-center transition-colors ${
                quadrant === null
                  ? 'bg-slate-100 border-slate-300 text-slate-700 font-semibold'
                  : 'border-dashed border-slate-200 text-slate-400 hover:text-slate-600'
              }`}
            >
              设为未分类 (null)
            </button>
          </div>

          {/* Planned Today Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div>
              <div className="text-xs font-semibold text-slate-800">加入今天视图</div>
              <div className="text-[10px] text-slate-400">计划今日重点执行</div>
            </div>
            <button
              onClick={handleTogglePlannedToday}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                task.planned_date
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {task.planned_date ? '已加入今天' : '加入今天'}
            </button>
          </div>

          {/* Background Text (PRD v1.2 A31, A34) */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                <span>背景说明 (用于 AI 理解任务背景与目标)</span>
              </span>
              <span className="text-[10px] text-slate-400">
                {backgroundText.length} / 10,000 字
              </span>
            </label>
            <textarea
              rows={3}
              value={backgroundText}
              onChange={(e) => handleBackgroundChange(e.target.value)}
              onBlur={handleBackgroundBlur}
              placeholder="为什么做？希望达到什么目标？有什么约束？帮助 AI 理解任务背景与目的"
              maxLength={10000}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-700 outline-none focus:border-indigo-500 focus:bg-white resize-none transition-colors"
            />
          </div>

          {/* Outcome Note (PRD 3.2 & v1.2 A34) */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>成果说明 (AI 复盘提炼依据)</span>
              </span>
              <span className="text-[10px] text-slate-400">
                {outcomeNote.length} / 2,000 字
              </span>
            </label>
            <textarea
              rows={2}
              value={outcomeNote}
              onChange={(e) => handleOutcomeNoteChange(e.target.value)}
              onBlur={handleOutcomeNoteBlur}
              placeholder="形成了什么具体内容？形成了什么结果或材料？"
              maxLength={2000}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-700 outline-none focus:border-emerald-500 focus:bg-white resize-none transition-colors"
            />
          </div>

          {/* Task Notes (PRD v1.2 A34) */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>任务备注</span>
              </span>
              <span className="text-[10px] text-slate-400">
                {note.length} / 10,000 字
              </span>
            </label>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder="日常记录、备忘、草稿或过程信息..."
              maxLength={10000}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 outline-none focus:border-blue-500 focus:bg-white resize-none transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDuplicateTask(task, false)}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
            title="复制节点 (象限与日期清空)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制</span>
          </button>

          <button
            onClick={() => onDuplicateTask(task, true)}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
            title="复制整棵子树"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>复制子树</span>
          </button>
        </div>

        <button
          onClick={() => {
            onDeleteTask(task);
            onClose();
          }}
          className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
          <span>删除任务</span>
        </button>
      </div>
    </div>
  );
};
