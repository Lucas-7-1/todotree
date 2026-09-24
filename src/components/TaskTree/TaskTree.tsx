import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TaskNode,
  QuadrantType,
  DueType,
  TaskViewMode
} from '../../types/todo';
import { TaskItemRow } from './TaskItemRow';
import { InlineTaskDraftRow } from './InlineTaskDraftRow';
import { TaskFilterBar } from './TaskFilterBar';
import {
  canMoveSubtree,
  getChildrenTasks,
  getAncestorPath,
  getAncestorNodes,
  getNodeDepth
} from '../../services/treeOperations';
import {
  TaskFilterState,
  DEFAULT_FILTER_STATE,
  GroupOption,
  SortOption,
  SortDirection,
  applyTaskFilters,
  sortTasks,
  groupTasks,
  isFilterActive,
  getLocalDateString
} from '../../services/filterEngine';
import {
  ChevronDown,
  Check,
  Layers,
  CheckCircle2,
  FolderTree,
  FilterX,
  Inbox
} from 'lucide-react';

interface TaskTreeProps {
  tasks: TaskNode[];
  selectedTaskId: string | null;
  onSelectTask: (task: TaskNode) => void;
  onToggleComplete: (task: TaskNode, outcomeNote?: string) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onUpdateQuadrant: (id: string, quadrant: QuadrantType) => void;
  onUpdateDue: (id: string, dueType: DueType, dateStr: string | null) => void;
  onAddChild: (parentId: string) => void;
  onAddTaskInline?: (parentId: string, title: string) => TaskNode | null;
  onDeleteTask: (task: TaskNode) => void;
  onDuplicateTask: (task: TaskNode, includeSubtree: boolean) => void;
  onTogglePlannedToday: (task: TaskNode) => void;
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
  showCompleted?: boolean;
  onToggleShowCompleted?: () => void;
  onOpenCompletedDrawer: () => void;
  onCloseCompletedDrawer?: () => void;
  isCompletedDrawerOpen?: boolean;
  reducedMotion?: boolean;
  searchQuery: string;
  onShowErrorToast: (msg: string) => void;
  onShowToastWithAction?: (title: string, actionLabel: string, onAction: () => void) => void;
  onToggleQuadrantQuick?: () => void;
  isQuadrantQuickOpen?: boolean;
}

export const TaskTree: React.FC<TaskTreeProps> = ({
  tasks,
  selectedTaskId,
  onSelectTask,
  onToggleComplete,
  onUpdateTitle,
  onUpdateQuadrant,
  onUpdateDue,
  onAddChild,
  onAddTaskInline,
  onDeleteTask,
  onDuplicateTask,
  onTogglePlannedToday,
  onMoveNode,
  showCompleted = false,
  onToggleShowCompleted,
  onOpenCompletedDrawer,
  onCloseCompletedDrawer,
  isCompletedDrawerOpen = false,
  reducedMotion = false,
  searchQuery = '',
  onShowErrorToast,
  onShowToastWithAction,
  onToggleQuadrantQuick,
  isQuadrantQuickOpen = false,
}) => {
  const [pendingConfirmTaskId, setPendingConfirmTaskId] = useState<string | null>(null);

  // View Mode state (PRD v1.3 Section 12.1)
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => {
    const saved = localStorage.getItem('todotree_task_view_mode');
    return saved === 'tree' || saved === 'list' || saved === 'project_group'
      ? (saved as TaskViewMode)
      : 'tree';
  });
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Composite Filter State (PRD Incremental v1.1 Section 1)
  const [filterState, setFilterState] = useState<TaskFilterState>(() => ({
    ...DEFAULT_FILTER_STATE,
    keywords: searchQuery || '',
  }));
  const [groupOption, setGroupOption] = useState<GroupOption>('none');
  const [sortOption, setSortOption] = useState<SortOption>('manual');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Inline Draft State (PRD Incremental v1.1 Section 2)
  const [inlineDraft, setInlineDraft] = useState<{ parentId: string; tempId: string } | null>(null);

  // Sync external searchQuery if passed from Header
  useEffect(() => {
    if (searchQuery !== filterState.keywords) {
      setFilterState((prev) => ({ ...prev, keywords: searchQuery }));
    }
  }, [searchQuery]);

  // Expansion state
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({
    'task-root-work': true,
    'task-procurement': true,
    'task-root-study': true,
    'task-root-life': true,
  });
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  // Pre-search expansion snapshot to restore upon clearing search (PRD 1.5)
  const preSearchExpandedMapRef = useRef<Record<string, boolean> | null>(null);
  const wasFilterActiveRef = useRef(false);

  const filterActive = isFilterActive(filterState);

  // Manage temporary tree expansion during search and restoration
  useEffect(() => {
    if (filterActive && !wasFilterActiveRef.current) {
      preSearchExpandedMapRef.current = { ...expandedMap };
    } else if (!filterActive && wasFilterActiveRef.current && preSearchExpandedMapRef.current) {
      setExpandedMap(preSearchExpandedMapRef.current);
      preSearchExpandedMapRef.current = null;
    }
    wasFilterActiveRef.current = filterActive;
  }, [filterActive]);

  // Run filter engine
  const todayStr = useMemo(() => getLocalDateString(), []);
  const openTasks = useMemo(() => tasks.filter((t) => !t.deleted_at && t.status === 'open'), [tasks]);

  const filterResult = useMemo(() => {
    return applyTaskFilters(tasks, filterState, todayStr);
  }, [tasks, filterState, todayStr]);

  // When searching, auto-expand necessary ancestors
  useEffect(() => {
    if (filterActive && filterResult.contextAncestorIds.size > 0) {
      setExpandedMap((prev) => {
        const next = { ...prev };
        for (const id of filterResult.contextAncestorIds) {
          next[id] = true;
        }
        return next;
      });
    }
  }, [filterActive, filterResult.contextAncestorIds]);

  // View Mode selection & Auto-switch for Quadrant/Date grouping (PRD 1.5)
  const handleSelectViewMode = (mode: TaskViewMode) => {
    setViewMode(mode);
    localStorage.setItem('todotree_task_view_mode', mode);
    setShowViewMenu(false);
  };

  const handleGroupChange = (group: GroupOption) => {
    setGroupOption(group);
    if ((group === 'quadrant' || group === 'due_date') && viewMode === 'tree') {
      setViewMode('list');
      localStorage.setItem('todotree_task_view_mode', 'list');
    }
  };

  useEffect(() => {
    if (!showViewMenu) return;
    const handleClickOutside = () => setShowViewMenu(false);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [showViewMenu]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    for (const t of tasks) {
      if (!t.deleted_at) {
        next[t.id] = true;
      }
    }
    setExpandedMap(next);
  };

  const handleCollapseAll = () => {
    setExpandedMap({});
  };

  const isAllExpanded = tasks.some((t) => !t.deleted_at && expandedMap[t.id]);

  // Drawer collapse on checkbox click / pending confirm start (PRD 3.3)
  const handleSetPendingConfirmTaskId = (id: string | null) => {
    if (id && isCompletedDrawerOpen && onCloseCompletedDrawer) {
      onCloseCompletedDrawer();
    }
    setPendingConfirmTaskId(id);
  };

  // Inline child addition handlers (PRD Section 2)
  const handleStartAddChildInline = (parentId: string) => {
    const parent = tasks.find((t) => t.id === parentId);
    if (!parent) return;

    // Check tree depth (max 5)
    const depth = getNodeDepth(tasks, parent) + 1;
    if (depth > 5) {
      onShowErrorToast('已达到最大层级深度 (5层)，无法添加子任务');
      return;
    }

    // Auto-expand parent node
    setExpandedMap((prev) => ({ ...prev, [parentId]: true }));

    // Set inline draft
    setInlineDraft({
      parentId,
      tempId: 'draft-' + Date.now(),
    });
  };

  const handleInlineSubmit = (parentId: string, title: string, continuous: boolean) => {
    if (onAddTaskInline) {
      const created = onAddTaskInline(parentId, title);
      if (created && filterActive) {
        // Check if created task matches active filter
        const matches = filterResult.matchedIds.has(created.id);
        if (!matches && onShowToastWithAction) {
          onShowToastWithAction('任务已创建，当前筛选下不可见', '清空筛选并定位', () => {
            setFilterState(DEFAULT_FILTER_STATE);
            onSelectTask(created);
          });
        }
      }
    } else {
      onAddChild(parentId);
    }

    if (continuous) {
      setInlineDraft({
        parentId,
        tempId: 'draft-' + Date.now(),
      });
    } else {
      setInlineDraft(null);
    }
  };

  const handleInlineCancel = () => {
    setInlineDraft(null);
  };

  // Move node with validation
  const handleMoveNodeWithValidation = (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside'
  ) => {
    const dragged = tasks.find((t) => t.id === draggedId);
    const target = tasks.find((t) => t.id === targetId);
    if (!dragged || !target) return;

    let newParentId: string | null = target.parent_id;
    if (position === 'inside') {
      newParentId = target.id;
    }

    const check = canMoveSubtree(tasks, dragged, newParentId);
    if (!check.allowed) {
      onShowErrorToast(check.reason || '无法移动此任务');
      return;
    }

    onMoveNode(draggedId, targetId, position);
  };

  // 1. Recursive Tree View Renderer
  const renderTreeNodes = (parentId: string | null, level = 1): React.ReactNode => {
    let children = getChildrenTasks(tasks, parentId);

    // Active main workspace strictly only renders open tasks (PRD Section 8)
    // Completed tasks and branches completely exit into the Completed Drawer!
    children = children.filter((c) => c.status === 'open' && !c.deleted_at);

    // Filter matching if filter active: keep nodes that are matched OR ancestors of matched items
    if (filterActive) {
      children = children.filter(
        (c) => filterResult.matchedIds.has(c.id) || filterResult.contextAncestorIds.has(c.id)
      );
    }

    // Sort sibling nodes under this parent without breaking tree structure (PRD 1.5)
    if (sortOption !== 'manual') {
      children = sortTasks(children, sortOption, sortDirection, todayStr);
    }

    const renderedItems = children.map((task, idx) => {
      const taskChildren = getChildrenTasks(tasks, task.id);
      const hasChildren = taskChildren.some(
        (c) =>
          !c.deleted_at &&
          c.status === 'open' &&
          (!filterActive || filterResult.matchedIds.has(c.id) || filterResult.contextAncestorIds.has(c.id))
      );
      const isExpanded = !!expandedMap[task.id];
      const isSelected = selectedTaskId === task.id;
      const isContextOnly = filterActive && !filterResult.matchedIds.has(task.id);
      const snippet = filterResult.taskSnippets.get(task.id);

      return (
        <React.Fragment key={task.id}>
          <TaskItemRow
            task={task}
            allTasks={tasks}
            level={level}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleExpand={toggleExpand}
            isSelected={isSelected}
            onSelect={onSelectTask}
            onToggleComplete={onToggleComplete}
            onUpdateTitle={onUpdateTitle}
            onUpdateQuadrant={onUpdateQuadrant}
            onUpdateDue={onUpdateDue}
            onAddChild={onAddChild}
            onAddChildInline={handleStartAddChildInline}
            onDeleteTask={onDeleteTask}
            onDuplicateTask={onDuplicateTask}
            onTogglePlannedToday={onTogglePlannedToday}
            onMoveNode={handleMoveNodeWithValidation}
            onDragStateChange={(isDrag, id) => setDraggingTaskId(isDrag ? id : null)}
            isLastChild={idx === children.length - 1}
            showCompleted={showCompleted}
            pendingConfirmTaskId={pendingConfirmTaskId}
            onSetPendingConfirmTaskId={handleSetPendingConfirmTaskId}
            reducedMotion={reducedMotion}
            matchSnippet={snippet}
            isContextOnly={isContextOnly}
          />
          {hasChildren && isExpanded && renderTreeNodes(task.id, level + 1)}
        </React.Fragment>
      );
    });

    // Render inline draft row at the end of direct children of this parent (PRD 2.1)
    const isDraftHere = inlineDraft && inlineDraft.parentId === parentId;

    return (
      <>
        {renderedItems}
        {isDraftHere && (
          <InlineTaskDraftRow
            key={inlineDraft.tempId}
            parentId={parentId!}
            level={level}
            onSubmit={handleInlineSubmit}
            onCancel={handleInlineCancel}
          />
        )}
      </>
    );
  };

  // 2. List View Renderer (Flat with Breadcrumbs & Grouping)
  const renderListView = (): React.ReactNode => {
    const sourceTasks = (filterActive ? filterResult.matchedTasks : openTasks).filter(
      (t) => !t.deleted_at && t.status === 'open'
    );

    if (sourceTasks.length === 0) {
      return renderEmptyState();
    }

    // Sort tasks
    const sorted = sortTasks(sourceTasks, sortOption, sortDirection, todayStr);

    // Group tasks
    const groups = groupTasks(sorted, tasks, groupOption, todayStr);

    return groups.map((group) => {
      const isCollapsed = !!collapsedGroups[group.id];

      return (
        <div key={group.id} className="mb-4">
          {groupOption !== 'none' && (
            <div
              onClick={() => toggleGroupCollapse(group.id)}
              className="flex items-center justify-between py-1.5 px-3 mb-1 bg-slate-100/70 hover:bg-slate-200/60 rounded-lg cursor-pointer transition-colors select-none text-xs font-bold text-slate-700"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
                <span>{group.title}</span>
                <span className="text-[11px] font-medium text-slate-400">({group.count})</span>
              </div>
            </div>
          )}

          {!isCollapsed &&
            group.tasks.map((task) => {
              const ancestors = getAncestorPath(tasks, task);
              const snippet = filterResult.taskSnippets.get(task.id);

              return (
                <div key={task.id} className="mb-1">
                  {ancestors.length > 0 && (
                    <div className="text-[11px] text-slate-400 pl-8 pb-0.5">
                      {ancestors.join(' / ')}
                    </div>
                  )}
                  <TaskItemRow
                    task={task}
                    allTasks={tasks}
                    level={1}
                    hasChildren={false}
                    isExpanded={false}
                    onToggleExpand={() => {}}
                    isSelected={selectedTaskId === task.id}
                    onSelect={onSelectTask}
                    onToggleComplete={onToggleComplete}
                    onUpdateTitle={onUpdateTitle}
                    onUpdateQuadrant={onUpdateQuadrant}
                    onUpdateDue={onUpdateDue}
                    onAddChild={onAddChild}
                    onAddChildInline={handleStartAddChildInline}
                    onDeleteTask={onDeleteTask}
                    onDuplicateTask={onDuplicateTask}
                    onTogglePlannedToday={onTogglePlannedToday}
                    onMoveNode={() => {}}
                    showCompleted={showCompleted}
                    pendingConfirmTaskId={pendingConfirmTaskId}
                    onSetPendingConfirmTaskId={handleSetPendingConfirmTaskId}
                    reducedMotion={reducedMotion}
                    matchSnippet={snippet}
                  />
                </div>
              );
            })}
        </div>
      );
    });
  };

  // 3. Project Group View Renderer
  const renderProjectGroupView = (): React.ReactNode => {
    const sourceTasks = (filterActive ? filterResult.matchedTasks : openTasks).filter(
      (t) => !t.deleted_at && t.status === 'open'
    );

    if (sourceTasks.length === 0) {
      return renderEmptyState();
    }

    const groups = groupTasks(sourceTasks, tasks, 'project', todayStr);

    return groups.map((group) => {
      const isCollapsed = !!collapsedGroups[group.id];
      const sortedInGroup = sortTasks(group.tasks, sortOption, sortDirection, todayStr);

      return (
        <div key={group.id} className="mb-4 bg-slate-50/50 rounded-xl p-2 border border-slate-100">
          <div
            onClick={() => toggleGroupCollapse(group.id)}
            className="flex items-center justify-between py-1.5 px-3 mb-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-lg cursor-pointer transition-colors select-none text-xs font-bold text-slate-800 shadow-2xs"
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
              />
              <span className="text-slate-800">{group.title}</span>
              <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.2 rounded-full">
                {group.count}
              </span>
            </div>
          </div>

          {!isCollapsed && (
            <div className="space-y-1 pl-1">
              {sortedInGroup.map((task) => {
                const ancestors = getAncestorPath(tasks, task);
                const snippet = filterResult.taskSnippets.get(task.id);

                return (
                  <div key={task.id}>
                    {ancestors.length > 0 && (
                      <div className="text-[10px] text-slate-400 pl-8 pb-0.5">
                        {ancestors.join(' / ')}
                      </div>
                    )}
                    <TaskItemRow
                      task={task}
                      allTasks={tasks}
                      level={1}
                      hasChildren={false}
                      isExpanded={false}
                      onToggleExpand={() => {}}
                      isSelected={selectedTaskId === task.id}
                      onSelect={onSelectTask}
                      onToggleComplete={onToggleComplete}
                      onUpdateTitle={onUpdateTitle}
                      onUpdateQuadrant={onUpdateQuadrant}
                      onUpdateDue={onUpdateDue}
                      onAddChild={onAddChild}
                      onAddChildInline={handleStartAddChildInline}
                      onDeleteTask={onDeleteTask}
                      onDuplicateTask={onDuplicateTask}
                      onTogglePlannedToday={onTogglePlannedToday}
                      onMoveNode={() => {}}
                      showCompleted={showCompleted}
                      pendingConfirmTaskId={pendingConfirmTaskId}
                      onSetPendingConfirmTaskId={handleSetPendingConfirmTaskId}
                      reducedMotion={reducedMotion}
                      matchSnippet={snippet}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  // Empty state renderer explaining conditions (PRD UI08: 4 distinct empty states)
  const renderEmptyState = () => {
    // State 1: Filter active with specific project/category scope
    if (filterActive && filterState.projectScope.rootId) {
      return (
        <div className="py-16 text-center text-xs text-slate-500 max-w-sm mx-auto select-none">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <FolderTree className="w-5 h-5 text-slate-400" />
          </div>
          <div className="font-semibold text-slate-700 text-sm mb-1">该分类下暂无任务</div>
          <p className="text-slate-400 text-xs mb-4 leading-relaxed">
            当前选定的分类或项目下没有未完成任务。
          </p>
          <button
            onClick={() =>
              setFilterState({
                ...filterState,
                projectScope: { rootId: null, includeDescendants: true },
              })
            }
            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            重置分类筛选
          </button>
        </div>
      );
    }

    // State 2: Filter active with no search/criteria matches
    if (filterActive) {
      return (
        <div className="py-16 text-center text-xs text-slate-500 max-w-sm mx-auto select-none">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <FilterX className="w-5 h-5" />
          </div>
          <div className="font-semibold text-slate-700 text-sm mb-1">未找到匹配任务</div>
          <p className="text-slate-400 text-xs mb-4 leading-relaxed">
            当前筛选条件下没有匹配的未完成任务，您可以调整筛选条件或一键清空重置。
          </p>
          <button
            onClick={() => setFilterState(DEFAULT_FILTER_STATE)}
            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            清空全部筛选
          </button>
        </div>
      );
    }

    // State 3: All active tasks are completed
    const nonDeletedTasks = tasks.filter((t) => !t.deleted_at);
    if (nonDeletedTasks.length > 0 && openTasks.length === 0) {
      return (
        <div className="py-16 text-center text-xs text-slate-500 max-w-sm mx-auto select-none">
          <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="font-semibold text-slate-800 text-sm mb-1">全部任务已完成！</div>
          <p className="text-slate-400 text-xs mb-4 leading-relaxed">
            恭喜！当前所有任务均已标记完成。您可以在已完成抽屉中回溯，或新建下一步计划。
          </p>
          <button
            onClick={onOpenCompletedDrawer}
            className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            查看已完成记录
          </button>
        </div>
      );
    }

    // State 4: Initial empty state (0 tasks in system)
    return (
      <div className="py-16 text-center text-xs text-slate-500 max-w-sm mx-auto select-none">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
          <Inbox className="w-5 h-5" />
        </div>
        <div className="font-semibold text-slate-800 text-sm mb-1">暂无任何任务</div>
        <p className="text-slate-400 text-xs mb-4 leading-relaxed">
          点击下方快速输入栏记下新想法，或使用顶部快捷模板快速建立任务结构。
        </p>
      </div>
    );
  };

  const completedCount = useMemo(
    () => tasks.filter((t) => !t.deleted_at && t.status === 'done').length,
    [tasks]
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-white select-none overflow-hidden relative">
      {/* 1. Composite Task Filter Bar (PRD Section 1) */}
      <TaskFilterBar
        filterState={filterState}
        onFilterChange={setFilterState}
        groupOption={groupOption}
        onGroupChange={handleGroupChange}
        sortOption={sortOption}
        sortDirection={sortDirection}
        onSortChange={(sort, dir) => {
          setSortOption(sort);
          setSortDirection(dir);
        }}
        allTasks={tasks}
        matchedCount={filterResult.matchedTasks.length}
        totalOpenCount={openTasks.length}
        onToggleQuadrantQuick={onToggleQuadrantQuick}
        isQuadrantQuickOpen={isQuadrantQuickOpen}
      />

      {/* 2. Secondary Sub-Toolbar */}
      <div className="px-8 py-2.5 flex items-center justify-between border-b border-slate-100 bg-slate-50/30">
        <div className="flex items-center gap-4">
          {/* View Mode Selector Dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowViewMenu((v) => !v);
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors shadow-2xs"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {viewMode === 'tree' ? '树状视图' : viewMode === 'list' ? '清单视图' : '项目分组'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showViewMenu && (
              <div
                className="absolute top-full left-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => handleSelectViewMode('tree')}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-slate-50 transition-colors ${
                    viewMode === 'tree' ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <Check
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      viewMode === 'tree' ? 'text-blue-600' : 'text-transparent'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">树状视图</div>
                    <div className="text-[11px] text-slate-400">保留父子层级关系，支持无限级折叠展开</div>
                  </div>
                </button>

                <button
                  onClick={() => handleSelectViewMode('list')}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-slate-50 transition-colors ${
                    viewMode === 'list' ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <Check
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      viewMode === 'list' ? 'text-blue-600' : 'text-transparent'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">清单视图</div>
                    <div className="text-[11px] text-slate-400">平铺展示任务，带面包屑完整路径</div>
                  </div>
                </button>

                <button
                  onClick={() => handleSelectViewMode('project_group')}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-slate-50 transition-colors ${
                    viewMode === 'project_group' ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <Check
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      viewMode === 'project_group' ? 'text-blue-600' : 'text-transparent'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">项目分组</div>
                    <div className="text-[11px] text-slate-400">按顶级分类分组汇聚，支持组级折叠</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Completed Secondary Drawer Entry Button */}
          <button
            onClick={onOpenCompletedDrawer}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors shadow-2xs cursor-pointer"
            title="打开已完成二级抽屉"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
            <span>已完成 ({completedCount})</span>
          </button>

          {/* Expand / Collapse all button */}
          {viewMode !== 'list' && (
            <button
              onClick={
                viewMode === 'project_group'
                  ? () => {
                      const allCollapsed = Object.values(collapsedGroups).every(Boolean);
                      const next: Record<string, boolean> = {};
                      tasks
                        .filter((t) => !t.deleted_at && !t.parent_id)
                        .forEach((t) => {
                          next[t.id] = !allCollapsed;
                        });
                      setCollapsedGroups(next);
                    }
                  : isAllExpanded
                  ? handleCollapseAll
                  : handleExpandAll
              }
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium cursor-pointer"
            >
              {viewMode === 'project_group'
                ? Object.values(collapsedGroups).some(Boolean)
                  ? '全部展开'
                  : '全部收起'
                : isAllExpanded
                ? '全部收起'
                : '全部展开'}
            </button>
          )}
        </div>

        <div className="text-xs text-slate-400 font-medium">已启用 5 层深度保护</div>
      </div>

      {/* 3. Table Column Headers */}
      <div className="px-8 py-2 border-b border-slate-100 flex items-center justify-between text-xs text-slate-400 font-medium bg-slate-50/50 select-none">
        <div className="flex-1 pl-7">任务</div>
        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="w-20 text-center">截止时间</div>
          <div className="w-28 text-center">四象限</div>
          <div className="w-6" />
        </div>
      </div>

      {/* 4. Tree/List Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-0.5">
        {filterActive && filterResult.matchedTasks.length === 0
          ? renderEmptyState()
          : viewMode === 'tree'
          ? renderTreeNodes(null, 1)
          : viewMode === 'list'
          ? renderListView()
          : renderProjectGroupView()}
      </div>

      {/* Floating Drag Hint Pill */}
      {draggingTaskId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-xl rounded-full px-5 py-2 flex items-center gap-3 z-40 text-xs font-semibold text-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none pointer-events-none">
          <span>拖入象限以分类</span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 font-normal">
            <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono text-slate-700 font-bold shadow-2xs">
              Esc
            </kbd>
            <span>取消</span>
          </span>
        </div>
      )}
    </div>
  );
};
