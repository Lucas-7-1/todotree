import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  MoreHorizontal,
  Plus,
  Scale,
  Moon,
  Utensils,
  X,
  Play,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { AppMode, AppModeSwitch } from "../AppModeSwitch";
import { TaskNode } from "../../types/todo";
import {
  HealthEntity,
  WorkoutTemplate,
  WorkoutSession,
  HealthSnapshot,
  entity,
  healthDay,
  newSession,
  templateExamples,
  healthId,
  dailyWeights,
  sleepDuration,
  quantityLabel,
} from "../../services/health/model";
import {
  commitHealth,
  exportHealth,
  importHealth,
  peekHealth,
  readHealth,
  retryHealthSave,
  subscribeHealth,
  syncHealthClock,
} from "../../services/health/store";
import {
  ensureHealthDay,
  queueWorkoutTask,
  syncWorkoutOutbox,
} from "../../services/health/actions";
import { isAndroid, NativeWorkspace } from "../../services/native/platform";
import { monthGrid, shiftMonth } from "../../services/journal/model";
import { HealthRecordEditor, RecordKind } from "./HealthRecordEditor";
import { WorkoutEditor } from "./WorkoutEditor";
import { WorkoutRunner } from "./WorkoutRunner";
import { foodIcon } from "../../services/health/food";
import "./health.css";
const labelKind = {
  weight: "体重",
  sleep: "睡眠",
  intake: "饮食",
  session: "训练",
};
export default function HealthApp(p: {
  onModeChange: (mode: AppMode) => void;
  tasks: TaskNode[];
  occurrenceId?: string | null;
  launchSessionId?: string;
  onLink: (
    occ: HealthEntity,
    type: "create" | "complete",
  ) => Promise<string | null>;
}) {
  const [data, setData] = useState<HealthSnapshot | null>(peekHealth()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"today" | "plans" | "trends">("today"),
    [day, setDay] = useState(healthDay()),
    [calendar, setCalendar] = useState(false),
    [month, setMonth] = useState(healthDay().slice(0, 7)),
    [editor, setEditor] = useState<RecordKind | null>(null),
    [editorRecord, setEditorRecord] = useState<HealthEntity | null>(null),
    [workoutEditor, setWorkoutEditor] = useState<{
      record: HealthEntity | null;
      initial: WorkoutTemplate;
      draft?: HealthEntity;
    } | null>(null),
    [sessionId, setSessionId] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [planTarget, setPlanTarget] = useState<HealthEntity | null>(null),
    [target, setTarget] = useState<HealthEntity | null>(null),
    [deleteTarget, setDeleteTarget] = useState<HealthEntity | null>(null),
    [trash, setTrash] = useState(false);
  const [planDate, setPlanDate] = useState(healthDay()),
    [planTime, setPlanTime] = useState(""),
    [repeat, setRepeat] = useState<"once" | "daily" | "weekly">("once"),
    [days, setDays] = useState<number[]>([1, 3, 5]);
  const [undo, setUndo] = useState<{
      before: HealthEntity;
      version: number;
    } | null>(null),
    [visible, setVisible] = useState(30),
    lock = useRef(false),
    hold = useRef<ReturnType<typeof setTimeout>>(),
    point = useRef({ x: 0, y: 0 }),
    alive = useRef(true);
  const records = data?.records || [],
    live = useMemo(() => records.filter((e) => !e.deleted_at), [records]),
    templates = live.filter((r) => r.kind === "template"),
    plans = live.filter((r) => r.kind === "plan"),
    sessions = live.filter((r) => r.kind === "session"),
    activeSession = sessions.find((r) => r.body.phase !== "finished"),
    session = sessionId ? sessions.find((r) => r.id === sessionId) : null;
  const dayRecords = live.filter(
    (r) =>
      r.day === day &&
      (["weight", "sleep", "intake"].includes(r.kind) ||
        (r.kind === "session" && r.body.phase === "finished")),
  );
  const dayOccurrences = live.filter(
      (r) =>
        r.kind === "occurrence" &&
        r.day === day &&
        !(
          day > healthDay() &&
          !r.body.task_id &&
          plans.find((p) => p.id === r.body.plan_id)?.body.paused
        ),
    ),
    pending = live.filter(
      (r) => r.kind === "outbox" && r.body.status === "pending",
    );
  const weightRows = dayRecords
      .filter((r) => r.kind === "weight")
      .sort((a, b) => b.body.occurred_at.localeCompare(a.body.occurred_at)),
    intakes = dayRecords.filter((r) => r.kind === "intake"),
    weightTrend = dailyWeights(live),
    unknown = intakes.filter((r) => r.body.kcal === null).length;
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (alive.current) setData(peekHealth());
    };
    const unsubscribe = subscribeHealth(refresh);
    void readHealth()
      .then(() => syncHealthClock())
      .then(() => ensureHealthDay(healthDay(), true))
      .then(refresh)
      .catch((e) => setError(e.message));
    document.documentElement.classList.add("health-open");
    return () => {
      alive.current = false;
      unsubscribe();
      clearTimeout(hold.current);
      document.documentElement.classList.remove("health-open");
    };
  }, []);
  useEffect(() => {
    void ensureHealthDay(day, day === healthDay()).catch((e) =>
      setError(e.message),
    );
    setVisible(30);
  }, [day]);
  const start = async (
    occ: HealthEntity | null,
    template?: WorkoutTemplate,
  ) => {
    await run(async () => {
      const existing = (await readHealth()).records.find(
        (r) =>
          r.kind === "session" && !r.deleted_at && r.body.phase !== "finished",
      );
      if (existing) {
        setSessionId(existing.id);
        setNotice("已恢复未结束的训练");
        return;
      }
      const next = newSession(occ, template || occ!.body.snapshot, healthDay());
      await commitHealth(() => [next]);
      setSessionId(next.id);
    });
  };
  useEffect(() => {
    if (!p.occurrenceId || !data) return;
    const occ = live.find(
      (r) => r.id === p.occurrenceId && r.kind === "occurrence",
    );
    if (occ) {
      const current = sessions.find((s) => s.body.occurrence_id === occ.id);
      if (current) setSessionId(current.id);
      else void start(occ);
    }
  }, [p.occurrenceId, !!data]);
  useEffect(() => {
    if (p.launchSessionId && data) {
      const record = live.find(
        (r) => r.id === p.launchSessionId && r.kind === "session",
      );
      if (record) setSessionId(record.id);
    }
  }, [p.launchSessionId, !!data]);
  const addToday = async (template: HealthEntity) =>
    run(async () => {
      const id = "manual-occ-" + template.id + "-" + healthDay(),
        occ =
          (await readHealth()).records.find((r) => r.id === id) ||
          entity(
            "occurrence",
            {
              template_id: template.id,
              template_version: template.version,
              snapshot: structuredClone(template.body),
              task_id: null,
              plan_id: null,
              time: null,
              state: "planned",
            },
            healthDay(),
            id,
          );
      await queueWorkoutTask(occ);
      await syncWorkoutOutbox(p.onLink, true);
      setTarget(null);
      setNotice(
        peekHealth()!.records.some(
          (r) => r.id === "link-" + occ.id && r.body.status === "pending",
        )
          ? "训练已保存，待办同步未完成；可以重试"
          : "本次训练已加入今天；重复点击不会重复建待办",
      );
    });
  const savePlan = async () =>
    run(async () => {
      if (!planTarget) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) throw Error("选择计划日期");
      if (repeat === "weekly" && !days.length)
        throw Error("选择至少一个训练日");
      await commitHealth(() => [
        entity(
          "plan",
          {
            template_id: planTarget.id,
            template_version: planTarget.version,
            snapshot: structuredClone(planTarget.body),
            start_date: planDate,
            end_date: null,
            time: planTime || null,
            repeat,
            days,
            paused: false,
          },
          planDate,
        ),
      ]);
      await ensureHealthDay(healthDay(), true);
      await syncWorkoutOutbox(p.onLink, true);
      setPlanTarget(null);
      setNotice("已保存计划，每次训练独立记录");
    });
  const recordText = (e: HealthEntity) =>
    e.kind === "weight"
      ? `${e.body.kg} kg`
      : e.kind === "sleep"
        ? `${new Date(e.body.start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} — ${new Date(e.body.end).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
        : e.kind === "intake"
          ? `${e.body.meal} · ${e.body.food.name}`
          : `${e.body.snapshot.title} · ${e.body.logs.length}组 / ${e.body.logs.reduce((n: number, l: any) => n + l.actual, 0)}次`;
  const recordSub = (e: HealthEntity) =>
    e.kind === "intake"
      ? `${quantityLabel(e.body)} · ${e.body.kcal === null ? "热量未知" : e.body.kcal + " kcal"}`
      : e.kind === "sleep"
        ? `手动记录 · ${((Date.parse(e.body.end) - Date.parse(e.body.start)) / 3600000).toFixed(1)}小时`
        : `${e.day} · 已确认记录`;
  const backup = () =>
    run(async () => {
      const content = await exportHealth();
      if (isAndroid())
        await NativeWorkspace.exportFile({
          content,
          filename: "TodoTree-Health-" + healthDay() + ".json",
          mimeType: "application/json",
        });
      else {
        const blob = new Blob([content], { type: "application/json" }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "TodoTree-Health-" + healthDay() + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice("已导出健康备份；待办与手帐可在各自设置中备份");
    });
  const importBackup = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file)
        void run(async () => {
          const result = await importHealth(JSON.parse(await file.text()));
          setNotice(
            `恢复 ${result.added} 条；${result.conflicts} 条同名冲突保留原记录`,
          );
        });
    };
    input.click();
  };
  const remove = (r: HealthEntity) =>
    run(async () => {
      await commitHealth((s) => {
        const old = s.records.find((e) => e.id === r.id)!;
        return [{ ...old, deleted_at: new Date().toISOString() }];
      });
      const after = peekHealth()!.records.find((e) => e.id === r.id)!;
      setUndo({ before: r, version: after.version });
      setDeleteTarget(null);
      setNotice("已移入健康回收站");
    });
  const undoDelete = () =>
    run(async () => {
      if (!undo) return;
      await commitHealth((s) => {
        const current = s.records.find((r) => r.id === undo.before.id);
        if (!current || current.version !== undo.version)
          throw Error("记录已修改，请使用回收站恢复");
        return [{ ...undo.before, version: current.version }];
      });
      setUndo(null);
      setNotice("已撤销删除");
    });
  const handlers = useRef<any>(null);
  handlers.current = {
    menu,
    editor,
    session,
    workoutEditor,
    planTarget,
    target,
    trash,
    run,
    undoDelete,
  };
  useEffect(() => {
    const back = (event: Event) => {
      const h = handlers.current;
      if (h.editor) return;
      event.preventDefault();
      if (h.session) setSessionId(null);
      else if (h.workoutEditor) setWorkoutEditor(null);
      else if (h.planTarget) setPlanTarget(null);
      else if (h.target) setTarget(null);
      else if (h.menu) setMenu(false);
      else if (h.trash) setTrash(false);
      else p.onModeChange("tasks");
    };
    const key = (ev: KeyboardEvent) => {
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.key.toLowerCase() === "z" &&
        !(ev.target as Element).closest("input,textarea,[contenteditable]")
      ) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        void handlers.current.undoDelete();
      }
    };
    window.addEventListener("todotree:back", back);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("todotree:back", back);
      window.removeEventListener("keydown", key, true);
    };
  }, []);
  const renderRecord = (r: HealthEntity) => (
    <article className="h-record" key={r.id}>
      <span className="h-record-icon">
        {r.kind === "weight" ? (
          <Scale size={20} />
        ) : r.kind === "sleep" ? (
          <Moon size={20} />
        ) : r.kind === "session" ? (
          <Dumbbell size={20} />
        ) : (
          foodIcon(r.body.food.name)
        )}
      </span>
      <div>
        <strong>{recordText(r)}</strong>
        <small>{recordSub(r)}</small>
        {r.body.note && <p>{r.body.note}</p>}
      </div>
      {trash ? (
        <button
          className="h-text"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await commitHealth((s) => [
                { ...s.records.find((e) => e.id === r.id)!, deleted_at: null },
              ]);
              setNotice("已恢复记录");
            })
          }
        >
          恢复
        </button>
      ) : (
        <button
          className="h-icon"
          aria-label={`记录操作 ${recordText(r)}`}
          onClick={() => setDeleteTarget(r)}
        >
          <MoreHorizontal size={18} />
        </button>
      )}
    </article>
  );
  return (
    <section className="h-shell" aria-label="健康模式">
      {editor ? (
        <HealthRecordEditor
          kind={editor}
          record={editorRecord}
          day={day > healthDay() ? healthDay() : day}
          records={records}
          draft={
            live.find(
              (r) =>
                r.kind === "draft" &&
                r.body.record_kind === editor &&
                (r.body.record_id || null) === (editorRecord?.id || null),
            ) || null
          }
          onClose={() => {
            setEditor(null);
            setEditorRecord(null);
          }}
          onSaved={() => {
            setEditor(null);
            setEditorRecord(null);
            setNotice("实际记录已保存");
          }}
        />
      ) : workoutEditor ? (
        <WorkoutEditor
          {...workoutEditor}
          onClose={() => setWorkoutEditor(null)}
          onSaved={() => {
            setWorkoutEditor(null);
            setNotice("模板已保存，历史训练未改变");
          }}
        />
      ) : session ? (
        <WorkoutRunner
          record={session}
          onClose={() => setSessionId(null)}
          onFinish={() =>
            void syncWorkoutOutbox(p.onLink).catch((e) => setError(e.message))
          }
        />
      ) : (
        <>
          <AppModeSwitch
            mode="health"
            disabled={busy}
            onChange={p.onModeChange}
          />
          <header className="h-header">
            <div>
              <h1>
                {trash
                  ? "健康回收站"
                  : tab === "plans"
                    ? "训练计划"
                    : tab === "trends"
                      ? "健康趋势"
                      : day === healthDay()
                        ? "健康今天"
                        : day + " 健康记录"}
              </h1>
              <small>
                {trash
                  ? "删除记录可恢复，不自动清空"
                  : "安排是计划，记录是实际发生"}
              </small>
            </div>
            {trash ? (
              <button
                className="h-icon"
                onClick={() => setTrash(false)}
                aria-label="退出健康回收站"
              >
                <X />
              </button>
            ) : (
              <>
                <button
                  className="h-icon"
                  aria-label="查看健康日历"
                  onClick={() => {
                    setCalendar((v) => !v);
                    setMonth(day.slice(0, 7));
                  }}
                >
                  <CalendarDays size={22} />
                </button>
                <button
                  className="h-icon"
                  aria-label="健康更多"
                  onClick={() => setMenu(true)}
                >
                  <MoreHorizontal size={22} />
                </button>
              </>
            )}
          </header>
          {notice && (
            <div className="h-notice" role="status">
              <span>{notice}</span>
              {undo && <button onClick={() => void undoDelete()}>撤销</button>}
              <button
                className="h-icon"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="h-error" role="alert">
              {error}
              <button
                onClick={() =>
                  void run(async () => {
                    await retryHealthSave();
                    setData(peekHealth());
                    setError("");
                  })
                }
              >
                重试保存 / 读取
              </button>
            </div>
          )}
          <div className="h-scroll">
            {!data && <p role="status">正在读取本机健康记录…</p>}
            {calendar && (
              <section className="h-calendar">
                <header>
                  <button
                    aria-label="健康上个月"
                    onClick={() => setMonth((m) => shiftMonth(m, -1))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <strong>{month}</strong>
                  <button
                    aria-label="健康下个月"
                    onClick={() => setMonth((m) => shiftMonth(m, 1))}
                  >
                    <ChevronRight size={20} />
                  </button>
                  <button
                    onClick={() => {
                      setDay(healthDay());
                      setMonth(healthDay().slice(0, 7));
                    }}
                  >
                    今天
                  </button>
                </header>
                <div className="h-month-grid">
                  {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                    <small key={d}>{d}</small>
                  ))}
                  {monthGrid(month).map((d) => (
                    <button
                      key={d}
                      aria-label={`${d}健康记录`}
                      aria-pressed={day === d}
                      className={d.slice(0, 7) !== month ? "h-out-month" : ""}
                      onClick={() => {
                        setDay(d);
                        setTab("today");
                      }}
                    >
                      <span>{Number(d.slice(-2))}</span>
                      {live.some(
                        (r) =>
                          r.day === d &&
                          (["weight", "sleep", "intake"].includes(r.kind) ||
                            (r.kind === "session" &&
                              r.body.phase === "finished")),
                      ) && <i />}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {pending.length > 0 && (
              <div className="h-pending-link">
                <span>{pending.length} 项训练已保存，待办待同步</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await syncWorkoutOutbox(p.onLink, true);
                    })
                  }
                >
                  重试同步
                </button>
              </div>
            )}
            {!trash && tab === "today" && (
              <>
                {live
                  .filter(
                    (r) =>
                      r.kind === "draft" &&
                      ["weight", "sleep", "intake"].includes(
                        r.body.record_kind,
                      ),
                  )
                  .map((d) => (
                    <button
                      className="h-example"
                      key={d.id}
                      onClick={() => {
                        setEditorRecord(
                          live.find((r) => r.id === d.body.record_id) || null,
                        );
                        setEditor(d.body.record_kind);
                      }}
                    >
                      <span>
                        <strong>
                          继续未保存的
                          {
                            labelKind[
                              d.body.record_kind as keyof typeof labelKind
                            ]
                          }
                          记录
                        </strong>
                        <small>草稿，未计入实际记录</small>
                      </span>
                      <ChevronRight size={20} />
                    </button>
                  ))}
                {activeSession && (
                  <button
                    className="h-resume"
                    onClick={() => setSessionId(activeSession.id)}
                  >
                    <Play size={21} />
                    <span>
                      <strong>继续未结束的训练</strong>
                      <small>
                        {activeSession.body.snapshot.title} ·{" "}
                        {activeSession.body.logs.length} 组已保存
                      </small>
                    </span>
                    <ChevronRight size={20} />
                  </button>
                )}
                <div className="h-section-heading">
                  <h2>当日训练</h2>
                  <button className="h-text" onClick={() => setTab("plans")}>
                    选模板 / 安排
                  </button>
                </div>
                {dayOccurrences.map((occ) => {
                  const task = p.tasks.find((t) => t.id === occ.body.task_id),
                    performed = sessions.find(
                      (s) =>
                        s.body.occurrence_id === occ.id &&
                        s.body.phase === "finished",
                    );
                  return (
                    <article className="h-workout-card" key={occ.id}>
                      <div className="h-workout-heading">
                        <Dumbbell size={22} />
                        <h3>{occ.body.snapshot.title}</h3>
                        <button
                          className="h-icon"
                          aria-label={`训练安排操作 ${occ.body.snapshot.title}`}
                          onClick={() => setTarget(occ)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                      <p>
                        {occ.body.snapshot.exercises
                          .map(
                            (e: any) => `${e.name} ${e.reps}次 × ${e.sets}组`,
                          )
                          .join(" · ")}
                      </p>
                      <div className="h-workout-footer">
                        <small>
                          {occ.body.time || "时间未指定"} ·{" "}
                          {performed
                            ? "已记录训练"
                            : task?.status === "done"
                              ? "安排已关闭，未记录训练详情"
                              : occ.body.task_id
                                ? "已加入今日待办"
                                : "本次安排"}
                        </small>
                        <button
                          className="h-primary"
                          disabled={busy}
                          onClick={() =>
                            performed
                              ? setSessionId(performed.id)
                              : void start(occ)
                          }
                        >
                          {performed ? "查看" : "开始训练"}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!dayOccurrences.length && (
                  <div className="h-training-empty">
                    <Dumbbell size={24} />
                    <span>还没有当日训练安排</span>
                    <button className="h-text" onClick={() => setTab("plans")}>
                      选一个模板开始
                    </button>
                  </div>
                )}
                <div className="h-section-heading">
                  <h2>记下实际情况</h2>
                </div>
                <div className="h-quick-records">
                  <button
                    disabled={day > healthDay()}
                    onClick={() => {
                      setEditorRecord(null);
                      setEditor("intake");
                    }}
                  >
                    <Utensils size={23} />
                    <strong>饮食</strong>
                    <span>
                      {intakes.length ? `${intakes.length}项` : "记一餐"}
                    </span>
                  </button>
                  <button
                    disabled={day > healthDay()}
                    onClick={() => {
                      setEditorRecord(null);
                      setEditor("weight");
                    }}
                  >
                    <Scale size={23} />
                    <strong>体重</strong>
                    <span>
                      {weightRows[0]?.body.kg
                        ? weightRows[0].body.kg + "kg"
                        : "记一次"}
                    </span>
                  </button>
                  <button
                    disabled={day > healthDay()}
                    onClick={() => {
                      setEditorRecord(null);
                      setEditor("sleep");
                    }}
                  >
                    <Moon size={23} />
                    <strong>睡眠</strong>
                    <span>
                      {dayRecords.some((r) => r.kind === "sleep")
                        ? (sleepDuration(dayRecords) / 3600000).toFixed(1) + "h"
                        : "记一觉"}
                    </span>
                  </button>
                </div>
                {intakes.length > 0 && (
                  <p className="h-intake-summary">
                    {intakes.every((r) => r.body.kcal === null)
                      ? "暂无可汇总热量"
                      : `已知部分 ${intakes.reduce((n, r) => n + (r.body.kcal ?? 0), 0).toFixed(1)} kcal`}
                    {unknown ? ` · ${unknown} 项热量未知` : ""} ·
                    不代表全天完整摄入
                  </p>
                )}
                <div className="h-section-heading">
                  <h2>当天实际记录</h2>
                  <span>{dayRecords.length} 条</span>
                </div>
                {dayRecords.slice(0, visible).map(renderRecord)}
                {!dayRecords.length && (
                  <p className="h-muted">
                    记一项就开始积累，不需要先填写个人档案。
                  </p>
                )}
              </>
            )}
            {!trash && tab === "plans" && (
              <>
                <div className="h-section-heading">
                  <h2>我的模板</h2>
                  <button
                    className="h-text"
                    onClick={() =>
                      setWorkoutEditor({
                        record: null,
                        initial: structuredClone(templateExamples[0]),
                      })
                    }
                  >
                    <Plus size={18} /> 新建
                  </button>
                </div>
                {live
                  .filter(
                    (r) =>
                      r.kind === "draft" && r.body.record_kind === "template",
                  )
                  .map((d) => (
                    <button
                      className="h-example"
                      key={d.id}
                      onClick={() =>
                        setWorkoutEditor({
                          record:
                            live.find((r) => r.id === d.body.template_id) ||
                            null,
                          initial: d.body.value,
                          draft: d,
                        })
                      }
                    >
                      <span>
                        <strong>
                          继续编辑 {d.body.value.title || "未命名模板"}
                        </strong>
                        <small>草稿，未生成训练安排</small>
                      </span>
                      <ChevronRight size={20} />
                    </button>
                  ))}
                {templates.map((t) => (
                  <article
                    className="h-template"
                    key={t.id}
                    onPointerDown={(ev) => {
                      if ((ev.target as Element).closest("button")) return;
                      point.current = { x: ev.clientX, y: ev.clientY };
                      hold.current = setTimeout(() => {
                        setTarget(t);
                        navigator.vibrate?.(10);
                      }, 400);
                    }}
                    onPointerMove={(ev) => {
                      if (
                        Math.hypot(
                          ev.clientX - point.current.x,
                          ev.clientY - point.current.y,
                        ) > 8
                      )
                        clearTimeout(hold.current);
                    }}
                    onPointerUp={() => clearTimeout(hold.current)}
                    onPointerCancel={() => clearTimeout(hold.current)}
                  >
                    <div>
                      <h3>{t.body.title}</h3>
                      <small>
                        {t.body.exercises
                          .map((e: any) => `${e.name} ${e.sets}×${e.reps}`)
                          .join(" · ")}
                      </small>
                    </div>
                    <button
                      className="h-icon"
                      aria-label={`模板操作 ${t.body.title}`}
                      onClick={() => setTarget(t)}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    <button
                      className="h-text"
                      disabled={busy}
                      onClick={() => void start(null, t.body)}
                    >
                      自由训练
                    </button>
                    <button
                      className="h-primary"
                      disabled={busy}
                      onClick={() => void addToday(t)}
                    >
                      加入今天
                    </button>
                  </article>
                ))}
                {!templates.length && (
                  <p className="h-muted">
                    先选一个常用模板，再按自己的训练修改。
                  </p>
                )}
                <h2>常用模板</h2>
                {templateExamples.map((t, i) => (
                  <button
                    key={i}
                    className="h-example"
                    onClick={() =>
                      setWorkoutEditor({
                        record: null,
                        initial: structuredClone(t),
                      })
                    }
                  >
                    <span>
                      <strong>{t.title}</strong>
                      <small>
                        {t.exercises
                          .map((e) => `${e.name} ${e.sets}×${e.reps}`)
                          .join(" · ")}
                      </small>
                    </span>
                    <Plus size={20} />
                  </button>
                ))}
                <h2>长期安排</h2>
                {plans.map((plan) => (
                  <article className="h-plan" key={plan.id}>
                    <strong>{plan.body.snapshot.title}</strong>
                    <small>
                      {plan.body.repeat === "daily"
                        ? "每天"
                        : plan.body.repeat === "weekly"
                          ? "每周 " + plan.body.days.join("、")
                          : plan.body.start_date}{" "}
                      · {plan.body.time || "无指定时间"} ·{" "}
                      {plan.body.paused ? "已暂停" : "有效"}
                    </small>
                    <button
                      className="h-text"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await commitHealth((s) => {
                            const old = s.records.find(
                              (e) => e.id === plan.id,
                            )!;
                            return [
                              {
                                ...old,
                                body: { ...old.body, paused: !old.body.paused },
                              },
                            ];
                          });
                          if (plan.body.paused)
                            await ensureHealthDay(healthDay(), true);
                        })
                      }
                    >
                      {plan.body.paused ? "恢复安排" : "暂停后续安排"}
                    </button>
                  </article>
                ))}
              </>
            )}
            {!trash && tab === "trends" && (
              <>
                <div className="h-section-heading">
                  <h2>体重变化</h2>
                  <button
                    className="h-text"
                    onClick={() => {
                      setEditorRecord(null);
                      setEditor("weight");
                    }}
                  >
                    记录
                  </button>
                </div>
                <p className="h-muted">
                  每天取最后一次已确认测量；缺失日期不补零。
                </p>
                {weightTrend.length > 1 && (
                  <WeightChart rows={weightTrend.slice(-30)} />
                )}
                <div className="h-weight-history">
                  {weightTrend
                    .slice(-30)
                    .reverse()
                    .map((r) => (
                      <div key={r.id}>
                        <span>{r.day}</span>
                        <strong>{r.body.kg} kg</strong>
                      </div>
                    ))}
                </div>
                {!weightTrend.length && (
                  <p className="h-muted">记录一次体重即可开始回看。</p>
                )}
                <h2>训练历史</h2>
                {sessions
                  .filter((s) => s.body.phase === "finished")
                  .sort((a, b) => b.day.localeCompare(a.day))
                  .slice(0, visible)
                  .map((r) => (
                    <button
                      key={r.id}
                      className="h-example"
                      onClick={() => setSessionId(r.id)}
                    >
                      <span>
                        <strong>{recordText(r)}</strong>
                        <small>{r.day} · 实际手动记录</small>
                      </span>
                      <ChevronRight size={20} />
                    </button>
                  ))}
                <button
                  className="h-text"
                  onClick={() => {
                    setTab("today");
                    setCalendar(true);
                  }}
                >
                  按日历查看饮食与睡眠
                </button>
              </>
            )}
            {trash &&
              records
                .filter(
                  (r) =>
                    r.deleted_at &&
                    ["weight", "sleep", "intake", "session"].includes(r.kind),
                )
                .slice(0, visible)
                .map(renderRecord)}
            {dayRecords.length > visible && (
              <button
                className="h-text"
                onClick={() => setVisible((v) => v + 30)}
              >
                加载更多记录
              </button>
            )}
          </div>
          {!trash && (
            <nav className="h-bottom" aria-label="健康导航">
              <button
                aria-current={tab === "today" ? "page" : undefined}
                onClick={() => setTab("today")}
              >
                <Activity size={23} />
                今天
              </button>
              <button
                aria-current={tab === "plans" ? "page" : undefined}
                onClick={() => setTab("plans")}
              >
                <Dumbbell size={23} />
                计划
              </button>
              <button
                aria-current={tab === "trends" ? "page" : undefined}
                onClick={() => setTab("trends")}
              >
                <TrendingUp size={23} />
                趋势
              </button>
            </nav>
          )}
        </>
      )}
      {menu && (
        <div className="h-backdrop" onClick={() => setMenu(false)}>
          <section
            className="h-sheet"
            role="dialog"
            aria-label="健康更多"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>健康数据与备份</h2>
            <button onClick={() => void backup()}>导出健康备份</button>
            <button onClick={importBackup}>
              导入健康备份（保留冲突原记录）
            </button>
            <button
              onClick={() => {
                setMenu(false);
                setTrash(true);
              }}
            >
              健康回收站
            </button>
            <p className="h-muted">
              正常重启保留本机记录。卸载 / 清除数据前，把备份存到应用外。
            </p>
            <button className="h-text" onClick={() => setMenu(false)}>
              收起
            </button>
          </section>
        </div>
      )}
      {target && (
        <div className="h-backdrop" onClick={() => setTarget(null)}>
          <section
            className="h-sheet"
            role="dialog"
            aria-label="训练操作"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{target.body.title || target.body.snapshot.title}</h2>
            {target.kind === "template" ? (
              <>
                <button disabled={busy} onClick={() => void addToday(target)}>
                  加入今天
                </button>
                <button
                  onClick={() => {
                    setPlanTarget(target);
                    setTarget(null);
                  }}
                >
                  安排日期 / 重复
                </button>
                <button
                  onClick={() => {
                    setWorkoutEditor({ record: target, initial: target.body });
                    setTarget(null);
                  }}
                >
                  编辑模板
                </button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await queueWorkoutTask(target);
                    await syncWorkoutOutbox(p.onLink, true);
                    setTarget(null);
                  })
                }
              >
                加入待办 / 查看已有关联
              </button>
            )}
            <button onClick={() => setTarget(null)}>取消</button>
          </section>
        </div>
      )}
      {planTarget && (
        <div className="h-backdrop">
          <section className="h-sheet" role="dialog" aria-label="安排训练">
            <h2>安排 {planTarget.body.title}</h2>
            <label>
              开始日期
              <input
                aria-label="训练计划日期"
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
              />
            </label>
            <label>
              时间（可空）
              <input
                aria-label="训练计划时间"
                type="time"
                value={planTime}
                onChange={(e) => setPlanTime(e.target.value)}
              />
            </label>
            <label>
              重复
              <select
                aria-label="训练重复规则"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as any)}
              >
                <option value="once">仅这一次</option>
                <option value="daily">每天</option>
                <option value="weekly">每周指定日</option>
              </select>
            </label>
            {repeat === "weekly" && (
              <div className="h-weekdays">
                {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => (
                  <button
                    key={i}
                    aria-pressed={days.includes(i + 1)}
                    onClick={() =>
                      setDays((old) =>
                        old.includes(i + 1)
                          ? old.filter((n) => n !== i + 1)
                          : [...old, i + 1],
                      )
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            <button
              className="h-primary"
              disabled={busy}
              onClick={() => void savePlan()}
            >
              保存计划
            </button>
            <button
              className="h-text"
              disabled={busy}
              onClick={() => setPlanTarget(null)}
            >
              取消
            </button>
            {error && <p className="h-error">{error}</p>}
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="h-backdrop">
          <section className="h-sheet" role="dialog" aria-label="健康记录操作">
            <h2>{recordText(deleteTarget)}</h2>
            <p>{deleteTarget.body.note || "记录可在回收站恢复"}</p>
            {deleteTarget.kind === "session" ? (
              <button
                onClick={() => {
                  setSessionId(deleteTarget.id);
                  setDeleteTarget(null);
                }}
              >
                查看训练详情
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditorRecord(deleteTarget);
                  setEditor(deleteTarget.kind as RecordKind);
                  setDeleteTarget(null);
                }}
              >
                编辑记录
              </button>
            )}
            <button
              className="h-danger"
              disabled={busy}
              onClick={() => void remove(deleteTarget)}
            >
              移入回收站
            </button>
            <button className="h-text" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
function WeightChart({ rows }: { rows: HealthEntity[] }) {
  const values = rows.map((r) => r.body.kg),
    min = Math.min(...values) - 0.2,
    max = Math.max(...values) + 0.2,
    start = Date.parse(rows[0].day),
    end = Date.parse(rows[rows.length - 1].day),
    points = rows.map((r) => [
      24 + ((Date.parse(r.day) - start) / Math.max(1, end - start)) * 280,
      140 - ((r.body.kg - min) / (max - min)) * 100,
    ]);
  return (
    <svg
      className="h-weight-chart"
      viewBox="0 0 330 180"
      role="img"
      aria-label={`体重由 ${values[0]} kg 变化到 ${values[values.length - 1]} kg`}
    >
      <path d="M24 140H304" stroke="#e2e8f0" />
      <polyline
        points={points.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="#2563eb"
        strokeWidth="3"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#2563eb" />
      ))}
      <text x="24" y="169">
        {rows[0].day.slice(5)}
      </text>
      <text x="267" y="169">
        {rows[rows.length - 1].day.slice(5)}
      </text>
      <text x="24" y="20">
        {values[0]} → {values[values.length - 1]} kg
      </text>
    </svg>
  );
}
