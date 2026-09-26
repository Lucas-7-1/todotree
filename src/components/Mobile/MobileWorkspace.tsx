import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
  CalendarDays,
  Check,
  ListChecks,
  Undo2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { TaskNode, ViewType, QuadrantType } from "../../types/todo";
import { SaveStatus } from "../../services/storage";
import { BulkAction } from "../../services/bulkTasks";
import {
  MobileTaskInput,
  indexMobileTasks,
  selectMobileToday,
  taskDueDay,
  quadrantLabels,
} from "../../services/mobileTasks";
import { formatDateInTimezone } from "../../services/calendarService";
import { getNodeDepth } from "../../services/treeOperations";
import { CompletionCalendar } from "../TodayView/CompletionCalendar";
import { MobileComposer, Draft } from "./MobileComposer";
import { MobileTaskRow } from "./MobileTaskRow";
import { useToday } from "./useMobile";
interface Props {
  tasks: TaskNode[];
  view: ViewType;
  timezone: string;
  saveStatus: SaveStatus;
  disabled: boolean;
  overlayOpen: boolean;
  onCreate: (input: MobileTaskInput) => Promise<boolean>;
  onBulk: (ids: string[], action: BulkAction) => Promise<boolean>;
  onSelect: (task: TaskNode) => void;
  onRestore: (task: TaskNode) => void;
  onArchive: (task: TaskNode) => void;
  onCompleted: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onPrepareComplete: () => void;
  onViewChange: (view: ViewType) => void;
}
type Sheet = "none" | "tools" | "picker" | "task" | "classify" | "delete";
export function MobileWorkspace(p: Props) {
  const draftCache = useRef<Record<string, Draft>>({});
  const today = useToday(p.timezone);
  const index = useMemo(() => indexMobileTasks(p.tasks), [p.tasks]);
  const active = ["today", "tree", "quadrant"].includes(p.view);
  const [parentId, setParentId] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [quadrant, setQuadrant] = useState<QuadrantType | "all">("all");
  const [sort, setSort] = useState<"default" | "priority">("default");
  const [quadrantTab, setQuadrantTab] = useState<QuadrantType>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showBacklog, setShowBacklog] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const scope = `${p.view}:${parentId || "root"}`;
  const parent = parentId ? index.byId.get(parentId) : null;
  const target = targetId ? index.byId.get(targetId) : null;
  const todayTasks = useMemo(
    () => selectMobileToday(p.tasks, today, p.timezone),
    [p.tasks, today, p.timezone],
  );
  const completed = useMemo(
    () =>
      p.tasks.filter(
        (t) =>
          !t.deleted_at &&
          t.status === "done" &&
          t.completed_at &&
          formatDateInTimezone(new Date(t.completed_at), p.timezone) === today,
      ),
    [p.tasks, today, p.timezone],
  );
  const leafCompleted = completed.filter(
    (t) => !index.children.get(t.id)?.length,
  );
  const isProject = (t: TaskNode) => !!index.children.get(t.id)?.length;
  const matches = (t: TaskNode, q = query) =>
    !q.trim() ||
    `${t.title} ${index.path(t)} ${t.note} ${t.background_text || ""}`
      .toLocaleLowerCase()
      .includes(q.trim().toLocaleLowerCase());
  const filtered = (list: TaskNode[]) =>
    list.filter(
      (t) => matches(t) && (quadrant === "all" || t.quadrant === quadrant),
    );
  const sorted = (list: TaskNode[]) =>
    sort === "priority"
      ? [...list].sort(
          (a, b) =>
            (a.quadrant || "Z").localeCompare(b.quadrant || "Z") ||
            a.sort_order - b.sort_order,
        )
      : list;
  const visibleToday = sorted(filtered(todayTasks.current));
  const projectRows = useMemo(
    () =>
      (query.trim()
        ? p.tasks.filter((t) => !t.deleted_at && !t.archived_at)
        : index.children.get(parentId) || []
      )
        .filter((t) => !t.archived_at)
        .sort(
          (a, b) =>
            Number(a.status === "done") - Number(b.status === "done") ||
            a.sort_order - b.sort_order,
        ),
    [p.tasks, index, parentId, query],
  );
  const pendingLive = [...pending].filter(
    (id) =>
      index.byId.get(id)?.status === "open" && !index.byId.get(id)?.archived_at,
  );
  const impacted = useMemo(() => {
    const ids = new Set<string>();
    for (const id of pendingLive) {
      ids.add(id);
      index
        .descendants(id)
        .filter((t) => t.status === "open")
        .forEach((t) => ids.add(t.id));
    }
    return ids.size;
  }, [index, pending]);
  const block = p.disabled || busy;
  const toggle = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) =>
    setter((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const complete = (task: TaskNode) => {
    p.onPrepareComplete();
    if (task.status === "done") {
      p.onRestore(task);
      return;
    }
    toggle(setPending, task.id);
  };
  const run = async (ids: string[], action: BulkAction) => {
    if (block || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await p.onBulk(ids, action);
      if (ok) {
        setSheet("none");
        setSelected(new Set());
        setSelecting(false);
        if (action.type === "complete")
          setPending(
            (old) => new Set([...old].filter((id) => !ids.includes(id))),
          );
      } else setNotice("操作未保存，请重试；当前选择已保留。");
      return ok;
    } catch {
      setNotice("操作失败，当前选择已保留。");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    setSheet("none");
    setSelecting(false);
    setSelected(new Set());
    setQuery("");
    setSearching(false);
    setCalendar(false);
    setQuadrant("all");
  }, [p.view]);
  useEffect(() => {
    if (!parentId) return;
    if (!parent || parent.archived_at) {
      let next = parent?.parent_id || null;
      const visited = new Set<string>();
      while (next && !visited.has(next)) {
        visited.add(next);
        const node = index.byId.get(next);
        if (node && !node.archived_at) break;
        next = node?.parent_id || null;
      }
      setParentId(next);
    }
  }, [index, parentId, parent]);
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = positions.current[scope] || 0;
  }, [scope, active, calendar]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented || !active || p.overlayOpen) return;
      if (sheet !== "none") {
        event.preventDefault();
        setSheet("none");
        return;
      }
      if (selecting) {
        event.preventDefault();
        setSelecting(false);
        setSelected(new Set());
        return;
      }
      if (searching) {
        event.preventDefault();
        setSearching(false);
        setQuery("");
        return;
      }
      if (calendar) {
        event.preventDefault();
        setCalendar(false);
        return;
      }
      if (p.view === "tree" && parentId) {
        event.preventDefault();
        setParentId(parent?.parent_id || null);
      }
    };
    window.addEventListener("todotree:back", back);
    return () => window.removeEventListener("todotree:back", back);
  }, [
    active,
    p.overlayOpen,
    sheet,
    selecting,
    searching,
    calendar,
    p.view,
    parentId,
    parent,
  ]);
  const openTask = (task: TaskNode) => {
    if (selecting) {
      toggle(setSelected, task.id);
      return;
    }
    if (isProject(task)) {
      setParentId(task.id);
      setQuery("");
      p.onViewChange("tree");
    } else p.onSelect(task);
  };
  const row = (task: TaskNode, todayView = false) => (
    <MobileTaskRow
      key={task.id}
      task={task}
      today={today}
      timezone={p.timezone}
      path={p.view === "tree" && !query ? "" : index.path(task)}
      childrenCount={index.children.get(task.id)?.length || 0}
      openChildren={
        (index.children.get(task.id) || []).filter((t) => t.status === "open")
          .length
      }
      pending={pending.has(task.id)}
      selected={selected.has(task.id)}
      selecting={selecting}
      todayView={todayView}
      disabled={block}
      onCheck={() =>
        selecting ? toggle(setSelected, task.id) : complete(task)
      }
      onOpen={() => openTask(task)}
      onMenu={() => {
        setTargetId(task.id);
        setSheet("task");
      }}
      onArchive={() => p.onArchive(task)}
    />
  );
  const empty = (title: string, description: string, arrange = false) => (
    <div className="m-empty">
      <span className="m-empty-icon">
        <ListChecks size={30} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {arrange && (
        <button
          className="m-primary"
          onClick={() => {
            setSelected(new Set());
            setPickerQuery("");
            setSheet("picker");
          }}
        >
          安排已有任务
        </button>
      )}
      {(query || quadrant !== "all") && (
        <button
          className="m-text-button"
          onClick={() => {
            setQuery("");
            setQuadrant("all");
          }}
        >
          清除筛选
        </button>
      )}
    </div>
  );
  useEffect(() => setVisibleCount(50), [scope, query, quadrant, quadrantTab]);
  const renderRows = (list: TaskNode[], todayView = false) => (
    <>
      {list.slice(0, visibleCount).map((t) => row(t, todayView))}
      {list.length > visibleCount && (
        <button
          className="m-text-button"
          onClick={() => setVisibleCount((n) => n + 50)}
        >
          继续显示（还有 {list.length - visibleCount} 项）
        </button>
      )}
    </>
  );
  const dueReason = target ? taskDueDay(target, p.timezone) : null;
  return (
    <section className="m-workspace" hidden={!active} data-mobile-view={p.view}>
      <header className="m-header">
        {((p.view === "tree" && parentId) || calendar) && (
          <button
            className="m-icon"
            aria-label="返回上一级"
            onClick={() =>
              calendar
                ? setCalendar(false)
                : setParentId(parent?.parent_id || null)
            }
          >
            <ChevronLeft size={24} />
          </button>
        )}
        <div className="m-heading">
          <h1>
            {calendar
              ? "完成日历"
              : p.view === "today"
                ? "今天"
                : p.view === "quadrant"
                  ? "四象限"
                  : parent?.title || "项目"}
          </h1>
          {p.view === "today" && !calendar ? (
            <button className="m-date-link" onClick={() => setCalendar(true)}>
              {today.slice(5).replace("-", "月")}日 · 完成日历
              <ChevronRight size={12} />
            </button>
          ) : (
            <span className="m-subtitle">
              {p.view === "tree"
                ? parent
                  ? index.path(parent) || "当前项目"
                  : "全部任务与项目"
                : p.view === "quadrant"
                  ? "手动分类，父子独立"
                  : "回看每天做了什么"}
            </span>
          )}
        </div>
        {!calendar && (
          <>
            <button
              className="m-icon"
              aria-label="搜索任务"
              onClick={() => setSearching((v) => !v)}
            >
              <Search size={21} />
            </button>
            <button
              className="m-icon"
              aria-label="页面更多"
              onClick={() => setSheet("tools")}
            >
              <MoreHorizontal size={23} />
            </button>
          </>
        )}
      </header>
      {p.saveStatus === "saving" && (
        <div className="m-saving" role="status">
          正在保存…
        </div>
      )}
      {notice && (
        <div className="m-notice" role="status">
          {notice}
        </div>
      )}
      {searching && !calendar && (
        <div className="m-search">
          <Search size={18} />
          <input
            aria-label="搜索标题和路径"
            placeholder="搜索标题、路径和备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            className="m-icon"
            aria-label="关闭搜索"
            onClick={() => {
              setQuery("");
              setSearching(false);
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {calendar ? (
        <CompletionCalendar
          tasks={p.tasks}
          timezone={p.timezone}
          onSelectTask={p.onSelect}
          onNavigateToTree={(id) => {
            setCalendar(false);
            const t = index.byId.get(id);
            if (t) p.onSelect(t);
          }}
        />
      ) : (
        <>
          {p.view === "today" && (
            <div className="m-progress">
              <span>
                待办{" "}
                <strong>
                  {todayTasks.current.filter((t) => !isProject(t)).length}
                </strong>
              </span>
              <button onClick={() => setShowHistory((v) => !v)}>
                已完成 <strong>{leafCompleted.length}</strong>
                <ChevronRight size={13} />
              </button>
              {todayTasks.current.some(isProject) && (
                <span className="m-project-count">
                  另有 {todayTasks.current.filter(isProject).length} 个项目
                </span>
              )}
            </div>
          )}
          {p.view === "quadrant" && (
            <div className="m-quadrant-tabs">
              {([null, "Q1", "Q2", "Q3", "Q4"] as QuadrantType[]).map((q) => (
                <button
                  key={q || "none"}
                  aria-pressed={quadrantTab === q}
                  onClick={() => setQuadrantTab(q)}
                >
                  {q ? quadrantLabels[q] : "未分类"}
                  <span>
                    {
                      p.tasks.filter(
                        (t) =>
                          !t.deleted_at &&
                          !t.archived_at &&
                          t.status === "open" &&
                          t.quadrant === q,
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
          )}
          {quadrant !== "all" && (
            <button
              className="m-filter-chip"
              onClick={() => setQuadrant("all")}
            >
              {quadrant ? quadrantLabels[quadrant] : "未分类"} × 清除
            </button>
          )}
          {selecting && (
            <div className="m-selection-heading">
              <span>选择任务 · {selected.size} 项</span>
              <button
                onClick={() => {
                  setSelecting(false);
                  setSelected(new Set());
                }}
              >
                退出选择
              </button>
            </div>
          )}
          <div
            className="m-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              positions.current[scope] = e.currentTarget.scrollTop;
            }}
          >
            {p.view === "today" && (
              <>
                {visibleToday.length > 0 && (
                  <section className="m-list" aria-label="今天要做">
                    {renderRows(visibleToday, true)}
                  </section>
                )}
                {!visibleToday.length &&
                  empty(
                    query || quadrant !== "all"
                      ? "没有符合条件的任务"
                      : leafCompleted.length
                        ? "今天的安排已完成"
                        : "今天还没有安排",
                    query
                      ? "试试其他关键词，或清除筛选。"
                      : leafCompleted.length
                        ? "回看今天的收获，或者继续记一件事。"
                        : "把已有任务安排进来，或在下方直接记录。",
                    !query && quadrant === "all",
                  )}
                {todayTasks.overdue.length + todayTasks.previous.length > 0 && (
                  <section className="m-backlog">
                    <button
                      className="m-section-toggle"
                      onClick={() =>
                        setShowBacklog(
                          !(showBacklog ?? !todayTasks.current.length),
                        )
                      }
                    >
                      <span>
                        需要重新安排{" "}
                        <small>
                          {todayTasks.overdue.length +
                            todayTasks.previous.length}
                        </small>
                      </span>
                      <ChevronRight
                        size={17}
                        className={
                          (showBacklog ?? !todayTasks.current.length)
                            ? "m-rotated"
                            : ""
                        }
                      />
                    </button>
                    {(showBacklog ?? !todayTasks.current.length) && (
                      <>
                        {todayTasks.overdue.length > 0 && (
                          <p className="m-section-note">
                            已逾期 · {todayTasks.overdue.length}
                          </p>
                        )}
                        {filtered(todayTasks.overdue)
                          .slice(0, visibleCount)
                          .map((t) => (
                            <div key={t.id}>
                              {row(t, true)}
                              <button
                                className="m-plan-inline"
                                disabled={block}
                                onClick={() =>
                                  void run([t.id], {
                                    type: "today",
                                    value: today,
                                  })
                                }
                              >
                                安排今天
                              </button>
                            </div>
                          ))}
                        {todayTasks.previous.length > 0 && (
                          <p className="m-section-note">
                            之前安排但未完成 · {todayTasks.previous.length}
                          </p>
                        )}
                        {filtered(todayTasks.previous)
                          .slice(0, visibleCount)
                          .map((t) => (
                            <div key={t.id}>
                              {row(t, true)}
                              <button
                                className="m-plan-inline"
                                disabled={block}
                                onClick={() =>
                                  void run([t.id], {
                                    type: "today",
                                    value: today,
                                  })
                                }
                              >
                                安排今天
                              </button>
                            </div>
                          ))}
                      </>
                    )}
                    {todayTasks.overdue.length + todayTasks.previous.length >
                      visibleCount && (
                      <button
                        className="m-text-button"
                        onClick={() => setVisibleCount((n) => n + 50)}
                      >
                        显示更多待安排任务
                      </button>
                    )}
                  </section>
                )}
                {completed.length > 0 && (
                  <section className="m-history">
                    <button
                      className="m-section-toggle"
                      onClick={() => setShowHistory((v) => !v)}
                    >
                      <span>
                        <Check size={15} />
                        今天已完成 {leafCompleted.length} 项
                        {completed.length > leafCompleted.length
                          ? ` · 闭环 ${completed.length - leafCompleted.length} 项`
                          : ""}
                      </span>
                      <ChevronRight
                        size={17}
                        className={showHistory ? "m-rotated" : ""}
                      />
                    </button>
                    {showHistory && (
                      <>
                        {completed.slice(0, visibleCount).map((t) => (
                          <button
                            key={t.id}
                            className="m-history-row"
                            onClick={() => p.onSelect(t)}
                          >
                            <Check size={16} />
                            <span>
                              {t.title}
                              <small>{index.path(t)}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                        <button
                          className="m-text-button"
                          onClick={() => setCalendar(true)}
                        >
                          在完成日历中查看
                        </button>
                      </>
                    )}
                  </section>
                )}
              </>
            )}
            {p.view === "tree" && (
              <>
                {parent && (
                  <div className="m-project-banner">
                    <span>
                      {parent.status === "done"
                        ? "已完成，等待归档"
                        : `${(index.children.get(parent.id) || []).filter((t) => t.status === "done").length} / ${(index.children.get(parent.id) || []).length} 项已完成`}
                    </span>
                    <button onClick={() => p.onSelect(parent)}>项目详情</button>
                  </div>
                )}
                {renderRows(sorted(filtered(projectRows)))}
                {!filtered(projectRows).length &&
                  empty(
                    query
                      ? "没有符合条件的任务"
                      : parent
                        ? "添加第一个子任务"
                        : "从一件事开始",
                    parent
                      ? "下方直接输入，即可在这里创建子任务。"
                      : "独立任务也可以直接记录，之后再细分。",
                  )}
                {parent?.status === "done" && (
                  <button
                    className="m-text-button"
                    onClick={() => p.onRestore(parent)}
                  >
                    重新打开，继续添加子任务
                  </button>
                )}
              </>
            )}
            {p.view === "quadrant" && (
              <>
                {renderRows(
                  sorted(
                    filtered(
                      p.tasks.filter(
                        (t) =>
                          !t.deleted_at &&
                          !t.archived_at &&
                          t.status === "open" &&
                          t.quadrant === quadrantTab,
                      ),
                    ),
                  ),
                  true,
                )}
                {!p.tasks.some(
                  (t) =>
                    !t.deleted_at &&
                    !t.archived_at &&
                    t.status === "open" &&
                    t.quadrant === quadrantTab,
                ) &&
                  empty(
                    "这里还没有任务",
                    "在任务的更多操作中，手动设置四象限。",
                  )}
              </>
            )}
          </div>
          {pendingLive.length > 0 && !selecting && (
            <div className="m-confirm-bar" role="region" aria-label="完成确认">
              <span>
                已勾选 {pendingLive.length} 项
                {impacted > pendingLive.length
                  ? ` · 含子项共 ${impacted} 项`
                  : ""}
              </span>
              <div>
                <button
                  className="m-text-button"
                  disabled={block}
                  onClick={() => setPending(new Set())}
                >
                  取消
                </button>
                <button
                  className="m-primary"
                  disabled={block}
                  onClick={() => void run(pendingLive, { type: "complete" })}
                >
                  {busy
                    ? "保存中…"
                    : pendingLive.length === 1
                      ? "确认完成"
                      : `确认完成 ${pendingLive.length} 项`}
                </button>
              </div>
            </div>
          )}
          {selecting && (
            <div className="m-bulk-bar">
              <button
                disabled={!selected.size || block}
                onClick={() =>
                  void run([...selected], { type: "today", value: today })
                }
              >
                安排今天
              </button>
              <button
                disabled={!selected.size || block}
                onClick={() => {
                  setPending((old) => new Set([...old, ...selected]));
                  setSelected(new Set());
                  setSelecting(false);
                }}
              >
                完成
              </button>
              <button
                disabled={!selected.size || block}
                onClick={() => {
                  setTargetId(null);
                  setSheet("classify");
                }}
              >
                象限
              </button>
              <button
                disabled={!selected.size || block}
                onClick={() => {
                  setTargetId(null);
                  setSheet("delete");
                }}
              >
                删除
              </button>
            </div>
          )}
          {p.view !== "quadrant" && (
            <MobileComposer
              draftCache={draftCache}
              scope={scope}
              parentId={p.view === "tree" ? parentId : null}
              today={today}
              planToday={p.view === "today"}
              tasks={p.tasks}
              disabled={
                block ||
                (p.view === "tree" &&
                  !!parent &&
                  (parent.status === "done" ||
                    getNodeDepth(p.tasks, parent) >= 5))
              }
              onCreate={p.onCreate}
            />
          )}
          {p.view === "tree" &&
            parent &&
            getNodeDepth(p.tasks, parent) >= 5 && (
              <p className="m-section-note">
                当前已到第 5 层，可返回上一级添加同级任务。
              </p>
            )}
        </>
      )}
      {sheet !== "none" && (
        <div
          className="m-sheet-backdrop"
          onClick={() => !busy && setSheet("none")}
        >
          <section
            className="m-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet === "picker" ? "安排已有任务" : "任务操作"}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>
                {sheet === "tools"
                  ? "页面选项"
                  : sheet === "picker"
                    ? "安排已有任务"
                    : sheet === "classify"
                      ? "设置四象限"
                      : sheet === "delete"
                        ? "移入回收站"
                        : target?.title || "任务操作"}
              </h2>
              <button
                className="m-icon"
                aria-label="关闭操作面板"
                onClick={() => setSheet("none")}
              >
                <X size={22} />
              </button>
            </header>
            {sheet === "tools" && (
              <div className="m-menu">
                <button
                  onClick={() => {
                    setSheet("none");
                    setSearching(true);
                  }}
                >
                  <Search size={19} />
                  搜索任务
                </button>
                {p.view === "today" && (
                  <button
                    onClick={() => {
                      setSelected(new Set());
                      setPickerQuery("");
                      setSheet("picker");
                    }}
                  >
                    <Plus size={19} />
                    安排已有任务
                  </button>
                )}
                <button
                  onClick={() => {
                    setSheet("none");
                    setSelecting(true);
                    setSelected(new Set());
                  }}
                >
                  <ListChecks size={19} />
                  选择多项任务
                </button>
                <label>
                  <SlidersHorizontal size={19} />
                  象限筛选
                  <select
                    value={quadrant === null ? "none" : quadrant}
                    onChange={(e) =>
                      setQuadrant(
                        e.target.value === "none"
                          ? null
                          : (e.target.value as QuadrantType | "all"),
                      )
                    }
                  >
                    <option value="all">全部</option>
                    <option value="none">未分类</option>
                    {Object.entries(quadrantLabels).map(([q, l]) => (
                      <option key={q} value={q}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  排序
                  <select
                    value={sort}
                    onChange={(e) =>
                      setSort(e.target.value as "default" | "priority")
                    }
                  >
                    <option value="default">
                      {p.view === "today" ? "截止时间与安排顺序" : "手动顺序"}
                    </option>
                    <option value="priority">手动象限优先</option>
                  </select>
                </label>
                <button
                  onClick={() => {
                    setSheet("none");
                    p.onCompleted();
                  }}
                >
                  <Check size={19} />
                  全部完成记录
                </button>
                <button
                  disabled={!p.canUndo || block}
                  onClick={() => {
                    setSheet("none");
                    p.onUndo();
                  }}
                >
                  <Undo2 size={19} />
                  撤销最近操作
                </button>
              </div>
            )}
            {sheet === "picker" && (
              <>
                <div className="m-search">
                  <Search size={18} />
                  <input
                    placeholder="搜索任务和项目路径"
                    aria-label="搜索待安排任务"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                  />
                </div>
                <div className="m-picker-list">
                  {p.tasks
                    .filter(
                      (t) =>
                        !t.deleted_at &&
                        !t.archived_at &&
                        t.status === "open" &&
                        matches(t, pickerQuery),
                    )
                    .slice(0, visibleCount)
                    .map((t) => (
                      <button
                        key={t.id}
                        className="m-picker-row"
                        aria-pressed={selected.has(t.id)}
                        onClick={() => toggle(setSelected, t.id)}
                      >
                        <span
                          className={`m-check ${selected.has(t.id) ? "checked" : ""}`}
                        >
                          {selected.has(t.id) && <Check size={14} />}
                        </span>
                        <span>
                          {t.title}
                          <small>
                            {index.path(t) || "独立任务"}
                            {t.planned_date === today ? " · 已安排今天" : ""}
                          </small>
                        </span>
                      </button>
                    ))}
                  <button
                    className="m-text-button"
                    onClick={() => setVisibleCount((n) => n + 50)}
                  >
                    显示更多任务
                  </button>
                </div>
                <button
                  className="m-primary"
                  disabled={!selected.size || block}
                  onClick={() =>
                    void run([...selected], { type: "today", value: today })
                  }
                >
                  安排今天（{selected.size}）
                </button>
              </>
            )}
            {sheet === "task" && target && (
              <div className="m-menu">
                <button
                  onClick={() => {
                    setSheet("none");
                    p.onSelect(target);
                  }}
                >
                  查看详情 / 调整截止日期
                </button>
                {target.planned_date !== today ? (
                  <button
                    onClick={() =>
                      void run([target.id], { type: "today", value: today })
                    }
                  >
                    安排今天
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      const ok = await run([target.id], {
                        type: "today",
                        value: null,
                      });
                      if (ok && dueReason === today)
                        setNotice("已取消今日安排，仍因今天截止显示。");
                      else if (ok && dueReason && dueReason < today)
                        setNotice("已取消今日安排，任务仍在逾期列表中。");
                    }}
                  >
                    取消今日安排{dueReason === today ? "（仍因截止显示）" : ""}
                  </button>
                )}
                <button onClick={() => setSheet("classify")}>设置四象限</button>
                {getNodeDepth(p.tasks, target) < 5 && (
                  <button
                    onClick={() => {
                      setSheet("none");
                      setParentId(target.id);
                      p.onViewChange("tree");
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLInputElement>(
                            ".m-composer-line input",
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    添加子任务
                  </button>
                )}
                {isProject(target) && (
                  <button
                    onClick={() => {
                      setSheet("none");
                      setParentId(target.id);
                      p.onViewChange("tree");
                    }}
                  >
                    查看子任务
                  </button>
                )}
                <button className="m-danger" onClick={() => setSheet("delete")}>
                  移入回收站
                </button>
              </div>
            )}
            {sheet === "classify" && (
              <div className="m-menu">
                {([null, "Q1", "Q2", "Q3", "Q4"] as QuadrantType[]).map((q) => (
                  <button
                    key={q || "none"}
                    disabled={block}
                    onClick={() =>
                      void run(target ? [target.id] : [...selected], {
                        type: "quadrant",
                        value: q,
                      })
                    }
                  >
                    {q ? quadrantLabels[q] : "未分类"}
                  </button>
                ))}
              </div>
            )}
            {sheet === "delete" && (
              <div className="m-menu">
                <p>所选任务及其子任务将移入回收站，可以恢复。</p>
                <button
                  className="m-danger"
                  disabled={block}
                  onClick={() =>
                    void run(target ? [target.id] : [...selected], {
                      type: "delete",
                    })
                  }
                >
                  确认移入回收站
                </button>
                <button onClick={() => setSheet("none")}>取消</button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
