import React, { useState, useRef, useEffect } from 'react';
import { QuadrantType, DueType, RecurrenceType, RecurrenceRule } from '../types/todo';
import { getTodayDateString } from '../services/seedData';
import { formatRecurrenceSummary } from '../services/recurrence';
import { Calendar, ChevronDown, Plus, X, Tag, Repeat } from 'lucide-react';

interface QuickInputBarProps {
  onAddTask: (
    title: string,
    parentId: string | null,
    dueType: DueType,
    dueDate: string | null,
    quadrant: QuadrantType,
    recurrenceRule?: RecurrenceRule | null
  ) => void;
  selectedParentId?: string | null;
  parentTitle?: string | null;
  onClearParent?: () => void;
}

export const QuickInputBar: React.FC<QuickInputBarProps> = ({
  onAddTask,
  selectedParentId = null,
  parentTitle = null,
  onClearParent,
}) => {
  const [title, setTitle] = useState('');
  const [dueType, setDueType] = useState<DueType>('none');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [quadrant, setQuadrant] = useState<QuadrantType>(null);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceDaysOfWeek, setRecurrenceDaysOfWeek] = useState<number[]>([5]); // default Friday
  const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState<number>(25);
  const [recurrenceStartDate, setRecurrenceStartDate] = useState<string>(getTodayDateString(0));
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showQuadrantPicker, setShowQuadrantPicker] = useState(false);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const quadrantPickerRef = useRef<HTMLDivElement>(null);
  const recurrencePickerRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
      if (quadrantPickerRef.current && !quadrantPickerRef.current.contains(e.target as Node)) {
        setShowQuadrantPicker(false);
      }
      if (recurrencePickerRef.current && !recurrencePickerRef.current.contains(e.target as Node)) {
        setShowRecurrencePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    let rule: RecurrenceRule | null = null;
    if (recurrenceType !== 'none') {
      rule = {
        id: 'rule-' + Date.now(),
        type: recurrenceType,
        interval: 1,
        days_of_week: recurrenceType === 'weekly' ? recurrenceDaysOfWeek : undefined,
        day_of_month: recurrenceType === 'monthly' ? recurrenceDayOfMonth : undefined,
        start_date: recurrenceStartDate || getTodayDateString(0),
        end_date: recurrenceEndDate || null,
        paused: false,
      };
    }

    onAddTask(trimmed, selectedParentId, dueType, dueDate, quadrant, rule);
    setTitle('');
    setDueType('none');
    setDueDate(null);
    setQuadrant(null);
    setRecurrenceType('none');
    setShowDatePicker(false);
    setShowQuadrantPicker(false);
    setShowRecurrencePicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleCreate();
    }
  };

  const setPresetDate = (days: number) => {
    setDueType('date');
    setDueDate(getTodayDateString(days));
    setShowDatePicker(false);
  };

  const clearDate = () => {
    setDueType('none');
    setDueDate(null);
    setShowDatePicker(false);
  };

  const quadrantLabels: Record<string, string> = {
    Q1: '重要且紧急',
    Q2: '重要不紧急',
    Q3: '紧急不重要',
    Q4: '不重要不紧急',
  };

  return (
    <div className="quick-input-bar px-6 pt-2 pb-6 flex-shrink-0 bg-gradient-to-t from-white via-white to-transparent">
      {/* Selected Parent Indicator (if adding child directly) */}
      {parentTitle && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-1 rounded-lg w-fit">
          <span>将在「{parentTitle}」下新增子任务</span>
          {onClearParent && (
            <button onClick={onClearParent} className="hover:text-blue-800">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Input Box (PRD UI09: 44-48px uniform height) */}
      <div className="quick-input-box bg-white border border-slate-200/90 rounded-2xl shadow-sm shadow-slate-100 h-[46px] px-3 flex items-center transition-all focus-within:border-blue-500 focus-within:shadow-md focus-within:shadow-blue-500/5">
        <div className="quick-input-fields flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-full border border-dashed border-slate-300 flex items-center justify-center text-slate-400 flex-shrink-0">
            <Plus className="w-3.5 h-3.5" />
          </div>

          <input
            ref={inputRef}
            type="text"
            placeholder="添加任务，先记下来也可以 (按 Enter 保存)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={200}
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none"
          />

          <button type="button" onClick={handleCreate} disabled={!title.trim()} className="mobile-add-task bg-blue-600 text-white rounded-lg px-3 disabled:opacity-40">添加</button>
          {/* Date Picker Button & Dropdown */}
          <div className="relative" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                dueDate
                  ? 'bg-blue-50 text-blue-600 border border-blue-200'
                  : 'text-slate-500 hover:bg-slate-100 border border-slate-200/70'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{dueDate || '设置截止日期'}</span>
            </button>

            {showDatePicker && (
              <div className="absolute right-0 bottom-full mb-2 w-52 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-30 space-y-1">
                <div className="text-[11px] text-slate-400 font-semibold px-2 py-0.5">快捷选择</div>
                <button
                  type="button"
                  onClick={() => setPresetDate(0)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  今天 ({getTodayDateString(0)})
                </button>
                <button
                  type="button"
                  onClick={() => setPresetDate(1)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  明天 ({getTodayDateString(1)})
                </button>
                <button
                  type="button"
                  onClick={() => setPresetDate(7)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  7天后 ({getTodayDateString(7)})
                </button>
                <div className="border-t border-slate-100 my-1" />
                <div className="px-2 py-1">
                  <input
                    type="date"
                    value={dueDate || ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setDueType('date');
                        setDueDate(e.target.value);
                      }
                    }}
                    className="w-full text-xs p-1 border border-slate-200 rounded outline-none"
                  />
                </div>
                {dueDate && (
                  <button
                    type="button"
                    onClick={clearDate}
                    className="w-full text-left px-2.5 py-1 text-xs text-rose-500 hover:bg-rose-50 rounded-lg"
                  >
                    清除日期
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quadrant Picker Button & Dropdown */}
          <div className="relative" ref={quadrantPickerRef}>
            <button
              type="button"
              onClick={() => setShowQuadrantPicker(!showQuadrantPicker)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                quadrant
                  ? 'bg-purple-50 text-purple-700 border border-purple-200 font-semibold'
                  : 'text-slate-500 hover:bg-slate-100 border border-slate-200/70'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{quadrant ? quadrantLabels[quadrant] : '未分类'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showQuadrantPicker && (
              <div className="absolute right-0 bottom-full mb-2 w-44 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 z-30 space-y-1">
                <div className="text-[10px] text-slate-400 font-semibold px-2 py-0.5">分配四象限</div>
                <button
                  type="button"
                  onClick={() => {
                    setQuadrant('Q1');
                    setShowQuadrantPicker(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span>重要且紧急 (Q1)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuadrant('Q2');
                    setShowQuadrantPicker(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>重要不紧急 (Q2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuadrant('Q3');
                    setShowQuadrantPicker(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-amber-600 hover:bg-amber-50 rounded-lg"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>紧急不重要 (Q3)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuadrant('Q4');
                    setShowQuadrantPicker(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span>不重要不紧急 (Q4)</span>
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setQuadrant(null);
                    setShowQuadrantPicker(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded-lg"
                >
                  <span className="w-2 h-2 rounded-full border border-slate-300" />
                  <span>留空 (未分类)</span>
                </button>
              </div>
            )}
          </div>

          {/* Recurrence Picker Button & Dropdown */}
          <div className="relative" ref={recurrencePickerRef}>
            <button
              type="button"
              onClick={() => setShowRecurrencePicker(!showRecurrencePicker)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                recurrenceType !== 'none'
                  ? 'bg-blue-50 text-blue-600 border border-blue-200 font-semibold'
                  : 'text-slate-500 hover:bg-slate-100 border border-slate-200/70'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>
                {recurrenceType === 'none'
                  ? '不重复'
                  : formatRecurrenceSummary({
                      id: '',
                      type: recurrenceType,
                      days_of_week: recurrenceDaysOfWeek,
                      day_of_month: recurrenceDayOfMonth,
                      start_date: recurrenceStartDate,
                    })}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showRecurrencePicker && (
              <div className="absolute right-0 bottom-full mb-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 z-30 space-y-2">
                <div className="text-[10px] text-slate-400 font-semibold px-1">重复规则</div>
                <div className="grid grid-cols-4 gap-1">
                  {(['none', 'daily', 'weekly', 'monthly'] as RecurrenceType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRecurrenceType(t)}
                      className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                        recurrenceType === t
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      {t === 'none' ? '不重复' : t === 'daily' ? '每天' : t === 'weekly' ? '每周' : '每月'}
                    </button>
                  ))}
                </div>

                {/* Weekly options */}
                {recurrenceType === 'weekly' && (
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <div className="text-[10px] text-slate-400 font-medium">选择星期几</div>
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
                        const isSelected = recurrenceDaysOfWeek.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                if (recurrenceDaysOfWeek.length > 1) {
                                  setRecurrenceDaysOfWeek(recurrenceDaysOfWeek.filter((d) => d !== day));
                                }
                              } else {
                                setRecurrenceDaysOfWeek([...recurrenceDaysOfWeek, day].sort());
                              }
                            }}
                            className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monthly options */}
                {recurrenceType === 'monthly' && (
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <div className="text-[10px] text-slate-400 font-medium">选择每月几号</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600">每月</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={recurrenceDayOfMonth}
                        onChange={(e) =>
                          setRecurrenceDayOfMonth(
                            Math.max(1, Math.min(31, parseInt(e.target.value) || 1))
                          )
                        }
                        className="w-16 p-1 text-xs border border-slate-200 rounded text-center outline-none focus:border-blue-500"
                      />
                      <span className="text-xs text-slate-600">日</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      若当月无此日，默认在当月最后一天执行
                    </div>
                  </div>
                )}

                {/* Date range if recurring */}
                {recurrenceType !== 'none' && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-100 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">开始日期</span>
                      <input
                        type="date"
                        value={recurrenceStartDate}
                        onChange={(e) => setRecurrenceStartDate(e.target.value)}
                        className="text-xs p-1 border border-slate-200 rounded outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">结束日期 (可选)</span>
                      <input
                        type="date"
                        value={recurrenceEndDate || ''}
                        onChange={(e) => setRecurrenceEndDate(e.target.value || null)}
                        className="text-xs p-1 border border-slate-200 rounded outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Helper Bar with quick chips matching mockup */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPresetDate(0)}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-[11px] transition-colors"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => setPresetDate(1)}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-[11px] transition-colors"
            >
              明天
            </button>
            <button
              type="button"
              onClick={() => setShowDatePicker(true)}
              className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-[11px] transition-colors"
            >
              选择日期
            </button>
          </div>
          <span className="text-[11px] text-slate-400">日期和四象限均可留空</span>
        </div>
      </div>
    </div>
  );
};
