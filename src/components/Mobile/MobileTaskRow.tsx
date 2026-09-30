import React from "react";
import { Check, ChevronRight, MoreHorizontal, Repeat2 } from "lucide-react";
import { TaskNode } from "../../types/todo";
import { quadrantLabels, taskDueDay } from "../../services/mobileTasks";
import { formatTimeInTimezone } from "../../services/calendarService";
interface Props {
  task: TaskNode;
  today: string;
  timezone: string;
  path: string;
  childrenCount: number;
  openChildren: number;
  pending: boolean;
  selected?: boolean;
  selecting?: boolean;
  todayView?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  draggable?: boolean;
  onArchivedChildren?: () => void;
  visibleChildren?: number;
  onCheck: () => void;
  onOpen: () => void;
  onMenu: () => void;
  onArchive: () => void;
  onStartWorkout?: () => void;
}
export function MobileTaskRow(p: Props) {
  const { task: t } = p;
  const done = t.status === "done";
  const due = taskDueDay(t, p.timezone);
  const dueLabel = due
    ? due < p.today
      ? `逾期 · ${due.slice(5)}`
      : due === p.today
        ? t.due_type === "datetime" && t.due_at
          ? `今天 ${formatTimeInTimezone(t.due_at, p.timezone)} 截止`
          : "今天截止"
        : `${due.slice(5)} 截止`
    : "";
  return (
    <article
      className={`m-task ${done ? "is-done" : ""} ${p.pending ? "is-pending" : ""} ${p.selected ? "is-selected" : ""}`}
      data-task-id={t.id}
      data-exit-on-complete={p.todayView ? "true" : undefined}
    >
      <button
        className="m-check-target"
        aria-label={
          p.selecting
            ? `${p.selected ? "取消选择" : "选择"} ${t.title}`
            : `${p.pending ? "取消勾选" : done ? "重新打开" : "勾选完成"} ${t.title}`
        }
        aria-pressed={p.selecting ? !!p.selected : p.pending || done}
        disabled={p.disabled}
        onClick={p.onCheck}
      >
        <span
          className={`m-check ${p.selecting ? (p.selected ? "checked" : "") : p.pending || done ? "checked" : ""}`}
        >
          {(p.selecting ? p.selected : p.pending || done) && (
            <Check size={14} />
          )}
        </span>
      </button>
      <div className="m-task-body">
        <button className="m-task-open" onClick={p.onOpen} data-drag-title={p.draggable ? t.id : undefined}>
          <span className="m-task-title">{t.title}</span>
        </button>
        {p.onStartWorkout && !p.selecting && <button className="m-workout-start" disabled={p.disabled} onClick={p.onStartWorkout}>开始训练</button>}
        {p.path && <span className="m-task-path">{p.path}</span>}
        <span className="m-task-meta">
          {p.childrenCount > 0 && (
            <button className="m-project-progress" disabled={p.disabled}
              aria-expanded={p.onExpand && p.visibleChildren ? !!p.expanded : undefined}
              aria-label={`子任务 ${t.title}`}
              onClick={p.onExpand ? p.visibleChildren ? p.onExpand : p.onArchivedChildren : p.onOpen}>
              <ChevronRight size={14} className={p.expanded ? 'm-rotated' : ''} />
              {p.onExpand ? p.visibleChildren ? `子任务 ${p.childrenCount - p.openChildren} / ${p.childrenCount}` : '子项已归档 · 查看记录'
                : done ? '子项已完成' : `还有 ${p.openChildren} 项未完成`}
            </button>
          )}
          {dueLabel && (
            <span className={due! < p.today ? "m-overdue" : "m-date"}>
              {dueLabel}
            </span>
          )}
          {t.quadrant && (
            <span className={`m-priority ${t.quadrant}`}>
              {quadrantLabels[t.quadrant]}
            </span>
          )}
          {t.recurrence_rule_id && (
            <span title="重复任务">
              <Repeat2 size={12} />
              重复
            </span>
          )}
          {p.pending && <span className="m-pending-label">待确认</span>}
        </span>
      </div>
      {!p.selecting &&
        (done ? (
          <div className="m-done-actions"><button
            className="m-archive"
            onClick={p.onArchive}
            disabled={p.disabled}
          >
            搞定
          </button><button className="m-icon" aria-label={`更多操作 ${t.title}`} onClick={p.onMenu} disabled={p.disabled}><MoreHorizontal size={18} /></button></div>
        ) : (
          <button
            className="m-icon"
            aria-label={`更多操作 ${t.title}`}
            onClick={p.onMenu}
          >
            <MoreHorizontal size={20} />
          </button>
        ))}
    </article>
  );
}
