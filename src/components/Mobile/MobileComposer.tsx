import React, { useEffect, useRef, useState } from "react";
import { Plus, ArrowUp, SlidersHorizontal, X } from "lucide-react";
import { TaskNode, RecurrenceType } from "../../types/todo";
import { MobileTaskInput, quadrantLabels } from "../../services/mobileTasks";
import { getNodeDepth } from "../../services/treeOperations";
interface Props {
  scope: string;
  parentId: string | null;
  today: string;
  planToday: boolean;
  tasks: TaskNode[];
  disabled: boolean;
  onCreate: (input: MobileTaskInput) => Promise<boolean>;
  draftCache: React.MutableRefObject<Record<string, Draft>>;
}
export interface Draft extends MobileTaskInput {
  repeat: RecurrenceType;
}
export function MobileComposer(p: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    p.draftCache.current,
  );
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const d: Draft = drafts[p.scope] || {
    title: "",
    parentId: p.parentId,
    plannedDate: p.planToday ? p.today : null,
    repeat: "none",
  };
  useEffect(() => {
    p.draftCache.current = drafts;
  }, [drafts, p.draftCache]);
  const patch = (part: Partial<Draft>) =>
    setDrafts((old) => ({ ...old, [p.scope]: { ...d, ...part } }));
  useEffect(() => {
    setExpanded(false);
    setError("");
  }, [p.scope]);
  useEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented) return;
      if (expanded) {
        event.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("todotree:back", back, true);
    return () => window.removeEventListener("todotree:back", back, true);
  }, [expanded]);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!d.title.trim() || p.disabled || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const date = d.plannedDate || p.today;
      const result = await p.onCreate({
        ...d,
        recurrenceRule:
          d.repeat === "none"
            ? null
            : {
                id: crypto.randomUUID(),
                type: d.repeat,
                interval: 1,
                start_date: date,
                days_of_week: [new Date(date + "T12:00:00").getDay() || 7],
                day_of_month: Number(date.slice(-2)),
              },
      });
      if (result) {
        setDrafts((old) => {
          const next = { ...old };
          delete next[p.scope];
          return next;
        });
        setExpanded(false);
        requestAnimationFrame(() => input.current?.focus());
      } else setError("未保存，请保留此输入并重试。");
    } catch {
      setError("保存失败，输入已保留。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const titleField = (detail: boolean) => (
    <input
      ref={detail ? undefined : input}
      autoFocus={detail}
      aria-label="任务标题"
      enterKeyHint="done"
      placeholder={
        p.parentId
          ? "输入子任务名称"
          : p.planToday
            ? "记一件今天要做的事"
            : "添加任务或项目"
      }
      value={d.title}
      onChange={(e) => patch({ title: e.target.value })}
      disabled={busy || p.disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          void submit();
        }
      }}
    />
  );
  return (
    <div className="m-composer">
      {!expanded && (
        <form className="m-composer-line" onSubmit={submit}>
          <Plus size={20} />
          {titleField(false)}
          <button
            type="button"
            className="m-icon"
            aria-label="设置新任务属性"
            onClick={() => setExpanded(true)}
          >
            <SlidersHorizontal size={19} />
          </button>
          <button
            className="m-send"
            type="submit"
            disabled={!d.title.trim() || busy || p.disabled}
            aria-label="保存任务"
          >
            <ArrowUp size={19} />
          </button>
        </form>
      )}
      {!expanded && d.title && p.planToday && d.plannedDate !== p.today && (
        <p className="m-section-note">
          草稿计划日期：{d.plannedDate || "未安排"}{" "}
          <button
            type="button"
            className="m-text-button"
            onClick={() => patch({ plannedDate: p.today })}
          >
            改为今天
          </button>
        </p>
      )}
      {error && !expanded && (
        <p role="alert" className="m-error">
          {error}
        </p>
      )}
      {expanded && (
        <div
          className="m-sheet-backdrop"
          onClick={() => !busy && setExpanded(false)}
        >
          <section
            className="m-sheet m-editor"
            role="dialog"
            aria-modal="true"
            aria-label="新建任务"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>记一件事</h2>
              <button
                type="button"
                className="m-icon"
                aria-label="收起新增面板"
                onClick={() => setExpanded(false)}
              >
                <X size={22} />
              </button>
            </header>
            <form onSubmit={submit} className="m-editor-form">
              <label>任务名称{titleField(true)}</label>
              <label>
                所属项目
                <select
                  value={d.parentId || ""}
                  onChange={(e) => patch({ parentId: e.target.value || null })}
                >
                  <option value="">独立任务 / 新项目</option>
                  {p.tasks
                    .filter(
                      (t) =>
                        !t.deleted_at &&
                        !t.archived_at &&
                        t.status === "open" &&
                        getNodeDepth(p.tasks, t) < 5,
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {"　".repeat(getNodeDepth(p.tasks, t) - 1)}
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              <div className="m-date-fields">
                <label>
                  计划执行日
                  <input
                    type="date"
                    value={d.plannedDate || ""}
                    onChange={(e) =>
                      patch({ plannedDate: e.target.value || null })
                    }
                  />
                </label>
                <label>
                  截止日期
                  <input
                    type="date"
                    value={d.dueDate || ""}
                    onChange={(e) => patch({ dueDate: e.target.value || null })}
                  />
                </label>
              </div>
              <details>
                <summary>优先级、重复与备注</summary>
                <label>
                  四象限
                  <select
                    value={d.quadrant || ""}
                    onChange={(e) =>
                      patch({
                        quadrant: (e.target.value || null) as Draft["quadrant"],
                      })
                    }
                  >
                    <option value="">未分类</option>
                    {Object.entries(quadrantLabels).map(([q, l]) => (
                      <option key={q} value={q}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  重复
                  <select
                    value={d.repeat}
                    onChange={(e) =>
                      patch({ repeat: e.target.value as RecurrenceType })
                    }
                  >
                    <option value="none">不重复</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </label>
                <label>
                  备注
                  <textarea
                    rows={3}
                    value={d.note || ""}
                    onChange={(e) => patch({ note: e.target.value })}
                  />
                </label>
              </details>
              {error && (
                <p role="alert" className="m-error">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="m-primary"
                disabled={!d.title.trim() || busy || p.disabled}
              >
                {busy ? "保存中…" : "保存任务"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
