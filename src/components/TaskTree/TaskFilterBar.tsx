import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Filter,
  ArrowUpDown,
  Layers,
  Calendar,
  Check,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  LayoutGrid
} from 'lucide-react';
import { TaskNode, QuadrantType } from '../../types/todo';
import {
  TaskFilterState,
  GroupOption,
  SortOption,
  SortDirection,
  DEFAULT_FILTER_STATE,
  isFilterActive,
  getLocalDateString
} from '../../services/filterEngine';

interface TaskFilterBarProps {
  filterState: TaskFilterState;
  onFilterChange: (next: TaskFilterState) => void;
  groupOption: GroupOption;
  onGroupChange: (group: GroupOption) => void;
  sortOption: SortOption;
  sortDirection: SortDirection;
  onSortChange: (sort: SortOption, direction: SortDirection) => void;
  allTasks: TaskNode[];
  matchedCount: number;
  totalOpenCount: number;
  onToggleQuadrantQuick?: () => void;
  isQuadrantQuickOpen?: boolean;
}

export const TaskFilterBar: React.FC<TaskFilterBarProps> = ({
  filterState,
  onFilterChange,
  groupOption,
  onGroupChange,
  sortOption,
  sortDirection,
  onSortChange,
  allTasks,
  matchedCount,
  totalOpenCount,
  onToggleQuadrantQuick,
  isQuadrantQuickOpen = false,
}) => {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showSearchScope, setShowSearchScope] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setShowGroupDropdown(false);
      }
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, []);

  const rootProjects = allTasks.filter(t => !t.parent_id && !t.deleted_at);

  const handleResetFilters = () => {
    onFilterChange(DEFAULT_FILTER_STATE);
  };

  const hasActiveFilters = isFilterActive(filterState);

  const activeChips: Array<{ id: string; label: string; onRemove: () => void }> = [];

  if (filterState.keywords.trim()) {
    activeChips.push({
      id: 'keywords',
      label: `关键词: "${filterState.keywords.trim()}"`,
      onRemove: () => onFilterChange({ ...filterState, keywords: '' }),
    });
  }

  if (filterState.importance !== 'all') {
    const map = { important: '重要 (Q1/Q2)', unimportant: '不重要 (Q3/Q4)', unclassified: '未分类' };
    activeChips.push({
      id: 'importance',
      label: map[filterState.importance],
      onRemove: () => onFilterChange({ ...filterState, importance: 'all' }),
    });
  }

  if (filterState.urgency !== 'all') {
    const map = { urgent: '紧急 (Q1/Q3)', not_urgent: '不紧急 (Q2/Q4)' };
    activeChips.push({
      id: 'urgency',
      label: map[filterState.urgency],
      onRemove: () => onFilterChange({ ...filterState, urgency: 'all' }),
    });
  }

  if (filterState.quadrants.length > 0) {
    const qLabels = filterState.quadrants.map(q => q || '未分类').join(', ');
    activeChips.push({
      id: 'quadrants',
      label: `象限: ${qLabels}`,
      onRemove: () => onFilterChange({ ...filterState, quadrants: [] }),
    });
  }

  if (filterState.timeFilter.preset !== 'all') {
    const fNames: Record<string, string> = {
      due_date: '截止',
      planned_date: '计划',
      created_at: '创建',
      updated_at: '更新',
    };
    const pNames: Record<string, string> = {
      overdue: '已逾期',
      today: '今天',
      tomorrow: '明天',
      this_week: '本周',
      next_7_days: '未来7天',
      unset: '未设置',
      custom: `${filterState.timeFilter.customStart || ''} ~ ${filterState.timeFilter.customEnd || ''}`,
    };
    activeChips.push({
      id: 'time',
      label: `${fNames[filterState.timeFilter.field]}: ${pNames[filterState.timeFilter.preset] || filterState.timeFilter.preset}`,
      onRemove: () => onFilterChange({ ...filterState, timeFilter: { field: 'due_date', preset: 'all' } }),
    });
  }

  if (filterState.projectScope.rootId) {
    const p = rootProjects.find(r => r.id === filterState.projectScope.rootId);
    activeChips.push({
      id: 'project',
      label: `项目: ${p ? p.title : '指定节点'}`,
      onRemove: () => onFilterChange({ ...filterState, projectScope: { rootId: null, includeDescendants: true } }),
    });
  }

  if (filterState.taskType !== 'all') {
    activeChips.push({
      id: 'taskType',
      label: filterState.taskType === 'normal' ? '普通任务' : '重复任务',
      onRemove: () => onFilterChange({ ...filterState, taskType: 'all' }),
    });
  }

  return (
    <div className="border-b border-slate-100 bg-white select-none">
      {/* Search and Action Buttons Row */}
      <div className="px-8 py-2.5 flex items-center gap-3">
        {/* Search input occupying main space */}
        <div className="relative flex-1 flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={filterState.keywords}
            onChange={(e) => onFilterChange({ ...filterState, keywords: e.target.value })}
            placeholder="搜索任务标题、路径（支持包含背景、备注检索）..."
            className="w-full pl-9 pr-24 py-1.5 text-xs bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-blue-500 rounded-lg outline-none text-slate-800 placeholder-slate-400 transition-all shadow-2xs"
          />

          {filterState.keywords && (
            <button
              onClick={() => onFilterChange({ ...filterState, keywords: '' })}
              className="absolute right-16 p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
              title="清空搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Search scope toggle button inside search box */}
          <button
            onClick={() => setShowSearchScope(!showSearchScope)}
            className={`absolute right-2 px-1.5 py-0.5 text-[11px] rounded flex items-center gap-1 transition-colors ${
              filterState.searchInFields.background || filterState.searchInFields.note || filterState.searchInFields.outcome
                ? 'bg-blue-100 text-blue-700 font-semibold'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'
            }`}
            title="搜索范围设置"
          >
            <span>范围</span>
            <ChevronDown className="w-2.5 h-2.5" />
          </button>

          {/* Scope Dropdown */}
          {showSearchScope && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 animate-in fade-in duration-100 text-xs">
              <div className="text-[11px] font-bold text-slate-400 px-2 py-1">搜索匹配字段</div>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={filterState.searchInFields.titleAndPath}
                  disabled
                  className="rounded text-blue-600"
                />
                <span>标题与层级路径 (默认)</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={filterState.searchInFields.background}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterState,
                      searchInFields: { ...filterState.searchInFields, background: e.target.checked },
                    })
                  }
                  className="rounded text-blue-600"
                />
                <span>背景说明 (Context)</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={filterState.searchInFields.note}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterState,
                      searchInFields: { ...filterState.searchInFields, note: e.target.checked },
                    })
                  }
                  className="rounded text-blue-600"
                />
                <span>任务备注</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={filterState.searchInFields.outcome}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterState,
                      searchInFields: { ...filterState.searchInFields, outcome: e.target.checked },
                    })
                  }
                  className="rounded text-blue-600"
                />
                <span>成果说明</span>
              </label>
            </div>
          )}
        </div>

        {/* Filter Popover Button */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border shadow-2xs ${
              hasActiveFilters
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>筛选</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
            )}
          </button>

          {/* Filter Popover Content */}
          {showFilterDropdown && (
            <div className="absolute top-full right-0 mt-1.5 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs text-slate-700 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <span className="font-bold text-slate-900 text-sm">多维组合筛选</span>
                {hasActiveFilters && (
                  <button
                    onClick={handleResetFilters}
                    className="text-blue-600 hover:text-blue-700 text-xs font-semibold"
                  >
                    重置全部
                  </button>
                )}
              </div>

              {/* 1. Importance */}
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">重要程度</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['all', 'important', 'unimportant', 'unclassified'] as const).map((imp) => (
                    <button
                      key={imp}
                      onClick={() => onFilterChange({ ...filterState, importance: imp })}
                      className={`px-2 py-1 rounded-md text-xs font-medium border text-center transition-colors ${
                        filterState.importance === imp
                          ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {imp === 'all' ? '全部' : imp === 'important' ? '重要' : imp === 'unimportant' ? '不重要' : '未分类'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Urgency */}
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">紧急程度</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['all', 'urgent', 'not_urgent'] as const).map((urg) => (
                    <button
                      key={urg}
                      onClick={() => onFilterChange({ ...filterState, urgency: urg })}
                      className={`px-2 py-1 rounded-md text-xs font-medium border text-center transition-colors ${
                        filterState.urgency === urg
                          ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {urg === 'all' ? '全部' : urg === 'urgent' ? '紧急' : '不紧急'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Quadrants Multi-Select */}
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">四象限多选 (OR)</div>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { q: 'Q1', label: 'Q1 重要且紧急' },
                    { q: 'Q2', label: 'Q2 重要不紧急' },
                    { q: 'Q3', label: 'Q3 紧急不重要' },
                    { q: 'Q4', label: 'Q4 不重要不紧急' },
                    { q: null, label: '未分类' },
                  ] as const).map(({ q, label }) => {
                    const selected = filterState.quadrants.includes(q);
                    return (
                      <button
                        key={String(q)}
                        onClick={() => {
                          const nextQ = selected
                            ? filterState.quadrants.filter((item) => item !== q)
                            : [...filterState.quadrants, q];
                          onFilterChange({ ...filterState, quadrants: nextQ });
                        }}
                        className={`px-2 py-1 rounded-md text-xs font-medium border flex items-center gap-1 transition-colors ${
                          selected
                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3 text-blue-600" />}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Time Boundaries */}
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">时间维度</div>
                <div className="flex items-center gap-2 mb-2">
                  <select
                    value={filterState.timeFilter.field}
                    onChange={(e) =>
                      onFilterChange({
                        ...filterState,
                        timeFilter: {
                          ...filterState.timeFilter,
                          field: e.target.value as any,
                        },
                      })
                    }
                    className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 outline-none"
                  >
                    <option value="due_date">截止日期</option>
                    <option value="planned_date">计划执行日期</option>
                    <option value="created_at">创建时间</option>
                    <option value="updated_at">更新时间</option>
                  </select>

                  <select
                    value={filterState.timeFilter.preset}
                    onChange={(e) =>
                      onFilterChange({
                        ...filterState,
                        timeFilter: {
                          ...filterState.timeFilter,
                          preset: e.target.value as any,
                        },
                      })
                    }
                    className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 outline-none"
                  >
                    <option value="all">不限时间</option>
                    {filterState.timeFilter.field === 'due_date' && <option value="overdue">已逾期</option>}
                    <option value="today">今天</option>
                    <option value="tomorrow">明天</option>
                    <option value="this_week">本周</option>
                    <option value="next_7_days">未来7天</option>
                    <option value="unset">未设置</option>
                    <option value="custom">自定义范围</option>
                  </select>
                </div>

                {filterState.timeFilter.preset === 'custom' && (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="date"
                      value={filterState.timeFilter.customStart || ''}
                      onChange={(e) =>
                        onFilterChange({
                          ...filterState,
                          timeFilter: {
                            ...filterState.timeFilter,
                            customStart: e.target.value,
                          },
                        })
                      }
                      className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 outline-none"
                    />
                    <span className="text-slate-400">至</span>
                    <input
                      type="date"
                      value={filterState.timeFilter.customEnd || ''}
                      onChange={(e) =>
                        onFilterChange({
                          ...filterState,
                          timeFilter: {
                            ...filterState.timeFilter,
                            customEnd: e.target.value,
                          },
                        })
                      }
                      className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 outline-none"
                    />
                  </div>
                )}
              </div>

              {/* 5. Project Scope */}
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">所属项目</div>
                <select
                  value={filterState.projectScope.rootId || ''}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterState,
                      projectScope: {
                        ...filterState.projectScope,
                        rootId: e.target.value || null,
                      },
                    })
                  }
                  className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 outline-none mb-1.5"
                >
                  <option value="">全部项目</option>
                  {rootProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>

                {filterState.projectScope.rootId && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterState.projectScope.includeDescendants}
                      onChange={(e) =>
                        onFilterChange({
                          ...filterState,
                          projectScope: {
                            ...filterState.projectScope,
                            includeDescendants: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-blue-600"
                    />
                    <span>包含该节点及全部后代</span>
                  </label>
                )}
              </div>

              {/* 6. Task Type */}
              <div>
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">任务类型</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['all', 'normal', 'recurring'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => onFilterChange({ ...filterState, taskType: type })}
                      className={`px-2 py-1 rounded-md text-xs font-medium border text-center transition-colors ${
                        filterState.taskType === type
                          ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {type === 'all' ? '全部' : type === 'normal' ? '普通任务' : '重复任务'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Group Selector Dropdown */}
        <div className="relative" ref={groupRef}>
          <button
            onClick={() => setShowGroupDropdown(!showGroupDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors shadow-2xs"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>
              分组: {groupOption === 'none' ? '不分组' : groupOption === 'project' ? '所属项目' : groupOption === 'quadrant' ? '四象限' : '截止日期'}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showGroupDropdown && (
            <div className="absolute top-full right-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in duration-100 text-xs">
              {([
                { id: 'none', label: '不分组' },
                { id: 'project', label: '所属项目' },
                { id: 'quadrant', label: '四象限' },
                { id: 'due_date', label: '截止日期' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onGroupChange(opt.id);
                    setShowGroupDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                    groupOption === opt.id ? 'bg-blue-50/60 font-semibold text-blue-700' : 'text-slate-700'
                  }`}
                >
                  <span>{opt.label}</span>
                  {groupOption === opt.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort Selector Dropdown */}
        <div className="relative" ref={sortRef}>
          <div className="flex items-center border border-slate-200 rounded-lg bg-white shadow-2xs overflow-hidden">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 text-slate-700 transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {sortOption === 'manual'
                  ? '手动顺序'
                  : sortOption === 'due_date'
                  ? '截止时间'
                  : sortOption === 'priority'
                  ? '优先级'
                  : sortOption === 'created_at'
                  ? '创建时间'
                  : sortOption === 'updated_at'
                  ? '更新时间'
                  : '标题'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {sortOption !== 'manual' && (
              <button
                onClick={() => onSortChange(sortOption, sortDirection === 'asc' ? 'desc' : 'asc')}
                className="px-2 py-1.5 text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:bg-slate-50 border-l border-slate-200 transition-colors"
                title={`切换排序方向 (当前: ${sortDirection === 'asc' ? '升序' : '降序'})`}
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </button>
            )}
          </div>

          {showSortDropdown && (
            <div className="absolute top-full right-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in duration-100 text-xs">
              {([
                { id: 'manual', label: '手动顺序' },
                { id: 'due_date', label: '截止时间' },
                { id: 'priority', label: '优先级 (Q1→Q4)' },
                { id: 'created_at', label: '创建时间' },
                { id: 'updated_at', label: '更新时间' },
                { id: 'title', label: '标题名称' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onSortChange(opt.id, sortDirection);
                    setShowSortDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                    sortOption === opt.id ? 'bg-blue-50/60 font-semibold text-blue-700' : 'text-slate-700'
                  }`}
                >
                  <span>{opt.label}</span>
                  {sortOption === opt.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quadrant Quick View Toggle Button (PRD Section 3.1) */}
        {onToggleQuadrantQuick && (
          <button
            onClick={onToggleQuadrantQuick}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border shadow-2xs ${
              isQuadrantQuickOpen
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
            title="按需开启右侧象限速览辅助面板 (不挤占主编辑区)"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-slate-500" />
            <span>象限速览</span>
          </button>
        )}
      </div>

      {/* Active Filter Chips & Match Count Row */}
      {hasActiveFilters && (
        <div className="px-8 pb-2.5 pt-0.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-500 font-medium">当前筛选:</span>
            {activeChips.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
              >
                <span>{chip.label}</span>
                <button
                  onClick={chip.onRemove}
                  className="p-0.5 hover:text-blue-900 rounded-full hover:bg-blue-100 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            <button
              onClick={handleResetFilters}
              className="text-xs text-slate-400 hover:text-slate-700 underline underline-offset-2 ml-1 transition-colors"
            >
              清空全部
            </button>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            共匹配 <span className="font-bold text-blue-600">{matchedCount}</span> 项任务 (总未完成 {totalOpenCount})
          </div>
        </div>
      )}
    </div>
  );
};
