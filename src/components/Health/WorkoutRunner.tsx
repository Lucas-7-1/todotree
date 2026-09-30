import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Timer, Minus, Undo2 } from "lucide-react";
import {
  HealthEntity,
  WorkoutSession,
  SessionAction,
  advanceSession,
  entity,
  restRemaining,
} from "../../services/health/model";
import {
  commitHealth,
  HealthNative,
  healthReminderError,
  nowClock,
  syncHealthClock,
} from "../../services/health/store";
import { isAndroid } from "../../services/native/platform";
export function WorkoutRunner(p: {
  record: HealthEntity;
  onClose: () => void;
  onFinish: () => void;
}) {
  const s = p.record.body as WorkoutSession,
    e = s.snapshot.exercises[s.exercise_index];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remaining, setRemaining] = useState(
      s.rest ? restRemaining(s.rest, nowClock()) : 0,
    ),
    [interactive, setInteractive] = useState(false),
    [actual, setActual] = useState(""),
    [restSeconds, setRestSeconds] = useState(String(e.rest_seconds)),
    [endSheet, setEndSheet] = useState(false),
    [closeTask, setCloseTask] = useState(false),
    [permissions, setPermissions] = useState<{
      granted: boolean;
      exact: boolean;
      countdown?: boolean;
      rest_channel?: boolean;
    } | null>(null);
  const lock = useRef(false),
    expired = useRef(""),
    latest = useRef(p);
  latest.current = p;
  const run = async (action: SessionAction) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await commitHealth((current) => {
        const old = current.records.find((r) => r.id === p.record.id);
        if (!old || old.deleted_at) throw Error("训练记录已变化");
        const body = advanceSession(old.body, action, nowClock());
        if (body === old.body) return [];
        const changes: HealthEntity[] = [{ ...old, body }];
        const occ = body.occurrence_id
          ? current.records.find((r) => r.id === body.occurrence_id)
          : null;
        if (body.phase === "finished" && occ) {
          changes.push({
            ...occ,
            body: {
              ...occ.body,
              state:
                body.partial && body.close_task
                  ? "closed"
                  : body.partial
                    ? "planned"
                    : "performed",
            },
          });
          if (
            body.close_task &&
            (occ.body.task_id ||
              current.records.some(
                (r) =>
                  r.kind === "outbox" &&
                  r.body.type === "create" &&
                  r.body.occurrence_id === occ.id,
              ))
          )
            changes.push(
              entity(
                "outbox",
                {
                  type: "complete",
                  occurrence_id: occ.id,
                  task_id: occ.body.task_id,
                  status: "pending",
                  attempts: 0,
                },
                occ.day,
                "close-" + old.id,
              ),
            );
        }
        return changes;
      });
      if (action.type === "rep" && !document.hidden) navigator.vibrate?.(8);
      if (
        action.type === "end" ||
        action.type === "finishSet" ||
        action.type === "rep"
      )
        p.onFinish();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const handlers = useRef({ run });
  handlers.current = { run };
  useEffect(() => {
    void syncHealthClock().catch((e) => setError(e.message));
    const resume = () => {
      if (!document.hidden)
        void syncHealthClock()
          .then(() =>
            setRemaining(
              latest.current.record.body.rest
                ? restRemaining(latest.current.record.body.rest, nowClock())
                : 0,
            ),
          )
          .catch((e) => setError(e.message));
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, []);
  useEffect(() => {
    if (!s.rest) return;
    const tick = () => {
      const clock = nowClock(),
        left = restRemaining(s.rest!, clock);
      setRemaining(left);
      if (
        !document.hidden &&
        left <= 0 &&
        !s.rest!.paused &&
        s.rest!.boot === clock.boot &&
        expired.current !== p.record.id + ":" + p.record.version
      ) {
        expired.current = p.record.id + ":" + p.record.version;
        void handlers.current.run({ type: "restDone" });
      }
    };
    tick();
    let id: ReturnType<typeof setInterval> | undefined;
    const visible = () => { if(id)clearInterval(id); id=undefined; if(!document.hidden){tick();id=setInterval(tick,250);} };
    visible(); document.addEventListener('visibilitychange',visible);
    return () => {if(id)clearInterval(id);document.removeEventListener('visibilitychange',visible);};
  }, [p.record.version]);
  useEffect(() => {
    setRestSeconds(String(e.rest_seconds));
    setActual("");
  }, [s.exercise_index, s.set_index]);
  useEffect(() => {
    if (isAndroid())
      void HealthNative.notificationStatus().then(setPermissions);
  }, [p.record.version]);
  const changedBoot = s.rest && s.rest.boot !== nowClock().boot,
    secs = Math.ceil(remaining / 1000),
    time =
      Math.floor(secs / 60)
        .toString()
        .padStart(2, "0") +
      ":" +
      (secs % 60).toString().padStart(2, "0");
  const completeSet = () => {
    const n = actual.trim() ? Number(actual) : undefined;
    void run({
      type: "finishSet",
      actual: n,
      restSeconds: Number(restSeconds),
    });
  };
  return (
    <section className="h-runner">
      <header className="h-header">
        <button
          className="h-icon"
          aria-label="收起训练"
          disabled={busy}
          onClick={p.onClose}
        >
          <ArrowLeft />
        </button>
        <div>
          <h1>{s.snapshot.title}</h1>
          <small>进度已在本机保存 · 随时返回</small>
        </div>
      </header>
      <div className="h-scroll">
        {s.phase === "finished" ? (
          <>
            <div className="h-session-result">
              <Check size={38} />
              <h2>{s.partial ? "本次训练已保存" : "本次训练已完成"}</h2>
              <p>
                已记录 {s.logs.length} 组 ·{" "}
                {s.logs.reduce((n, l) => n + l.actual, 0)} 次
              </p>
              <small>
                {s.close_task
                  ? "关联的本次安排会关闭，长期计划继续保留"
                  : "保留本次未完成安排"}
              </small>
            </div>
            <button className="h-primary h-wide" onClick={p.onClose}>
              回到健康今天
            </button>
          </>
        ) : (
          <>
            <div className="h-section-heading">
              <h2>{e.name}</h2>
              <span>
                第 {s.set_index + 1} / {e.sets} 组
              </span>
            </div>
            <p className="h-muted">
              {e.load_basis === "bodyweight"
                ? "自重"
                : `${e.load_kg ?? "未填"} kg · ${e.load_basis === "each" ? "单只" : e.load_basis === "assistance" ? "助力" : "总重量"}`}{" "}
              · 目标 {e.reps} 次
            </p>
            {s.phase === "rest" ? (
              <>
                <div className="h-rest-face">
                  <Timer size={28} />
                  <strong>{time}</strong>
                  <span>
                    {s.rest?.paused ? "休息已暂停" : "组间休息 · 下一组准备"}
                  </span>
                </div>
                {changedBoot && (
                  <p className="h-error">
                    计时环境已变化，保留了组记录。请确认剩余时间，或结束休息进入准备。
                  </p>
                )}
                <div className="h-rest-actions">
                  <button
                    onClick={() => void run({ type: "pause" })}
                    disabled={busy}
                  >
                    {s.rest?.paused ? "继续" : "暂停"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run({ type: "addRest", seconds: 30 })}
                  >
                    ＋30 秒
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run({ type: "restDone" })}
                  >
                    结束休息
                  </button>
                </div>
                {isAndroid() && (
                  <div className="h-reminder-note">
                    <p>
                      {permissions?.granted && permissions.rest_channel !== false
                        ? permissions.countdown ? "原生休息计时运行中，可锁屏；到时提醒进入下一组准备" : s.rest?.paused ? "休息计时已暂停" : "正在设置原生计时，请检查通知栏"
                        : "训练通知未开启；应用内计时可用"}
                    </p>
                    <p>前台计时仅在休息时运行。手机品牌的后台限制仍需实机核对；系统计时器由系统单独管理。</p>
                    {!permissions?.granted && (
                      <button
                        onClick={() =>
                          void HealthNative.requestNotifications()
                            .then(setPermissions)
                            .catch((e) => setError(e.message))
                        }
                      >
                        开启休息通知
                      </button>
                    )}
                    <button
                      onClick={() =>
                        void HealthNative.openTimer({
                          seconds: Math.max(1, secs),
                        }).catch((e) => setError(e.message))
                      }
                    >
                      打开系统计时器
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="h-rep-face">
                  <strong>
                    {s.reps}
                    <small>/ {e.reps}</small>
                  </strong>
                  <span>
                    {s.phase === "active"
                      ? "本组已记录次数"
                      : s.phase === "next"
                        ? "休息结束，开始下一组"
                        : "准备就绪"}
                  </span>
                </div>
                {s.phase === "active" ? (
                  <>
                    <button
                      className="h-primary h-wide"
                      disabled={busy}
                      onClick={completeSet}
                    >
                      本组已做完
                    </button>
                    <details className="h-set-options">
                      <summary>实际次数与本组休息</summary>
                      <div className="h-fields">
                        <label>
                          实际次数
                          <input
                            aria-label="本组实际次数"
                            placeholder={String(e.reps)}
                            type="number"
                            min="0"
                            max="1000"
                            value={actual}
                            onChange={(ev) => setActual(ev.target.value)}
                          />
                        </label>
                        <label>
                          本组休息（秒）
                          <input
                            aria-label="本组休息秒数"
                            type="number"
                            min="0"
                            max="3600"
                            value={restSeconds}
                            onChange={(ev) => setRestSeconds(ev.target.value)}
                          />
                        </label>
                      </div>
                    </details>
                    <button
                      className="h-text h-wide"
                      aria-expanded={interactive}
                      onClick={() => setInteractive((v) => !v)}
                    >
                      {interactive ? "收起互动计次" : "展开互动计次"}
                    </button>
                    {interactive && (
                      <div className="h-interaction">
                        <button
                          className="h-pushup"
                          aria-label="记录一次动作"
                          disabled={busy}
                          onClick={() =>
                            void run({
                              type: "rep",
                              restSeconds: Number(restSeconds),
                            })
                          }
                        >
                          <svg
                            key={s.reps}
                            viewBox="0 0 180 100"
                            aria-hidden="true"
                          >
                            <path
                              className="h-push-body"
                              d="M37 47 L125 64 M58 50 L52 80 L35 80 M125 64 L153 80"
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="8"
                              strokeLinecap="round"
                            />
                            <circle
                              className="h-push-head"
                              cx="25"
                              cy="42"
                              r="12"
                              fill="#2563eb"
                            />
                            <path
                              d="M18 88H162"
                              stroke="#dbeafe"
                              strokeWidth="4"
                            />
                          </svg>
                          <span>点一下，记录一次</span>
                        </button>
                        <button
                          className="h-text"
                          disabled={busy || s.reps === 0}
                          onClick={() => void run({ type: "minus" })}
                        >
                          <Minus size={16} /> 撤回一次
                        </button>
                        <small>手动计次，非动作识别；也可直接完成本组。</small>
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    className="h-primary h-wide"
                    disabled={busy}
                    onClick={() => void run({ type: "start" })}
                  >
                    {s.phase === "next" ? "开始下一组" : "开始本组"}
                  </button>
                )}
              </>
            )}
            {s.logs.length > 0 && (
              <button
                className="h-text h-wide"
                disabled={busy}
                onClick={() => void run({ type: "undoSet" })}
              >
                <Undo2 size={16} /> 撤回上一组完成
              </button>
            )}
            <button
              className="h-text h-wide"
              disabled={busy}
              onClick={() => setEndSheet(true)}
            >
              提前结束并保存已做部分
            </button>
          </>
        )}
        {s.logs.length > 0 && (
          <section className="h-history">
            <h2>本次已记录</h2>
            {s.logs.map((l) => (
              <div key={l.exercise_id + ":" + l.index}>
                <strong>
                  {
                    s.snapshot.exercises.find((e) => e.id === l.exercise_id)
                      ?.name
                  }{" "}
                  · 第{l.index + 1}组
                </strong>
                <span>
                  {l.actual} / {l.target} 次
                </span>
              </div>
            ))}
          </section>
        )}
        {healthReminderError() && (
          <p className="h-error">{healthReminderError()}</p>
        )}
        {error && (
          <p className="h-error" role="alert">
            {error}
          </p>
        )}
        {endSheet && (
          <div className="h-backdrop">
            <section
              className="h-sheet"
              role="dialog"
              aria-label="结束本次训练"
            >
              <h2>保存本次实际训练</h2>
              <p>只保留已经记录的次数，未做部分不补成完成。</p>
              <label className="h-check-label">
                <input
                  type="checkbox"
                  checked={closeTask}
                  onChange={(ev) => setCloseTask(ev.target.checked)}
                />
                同时关闭本次待办安排
              </label>
              <button
                className="h-primary"
                disabled={busy}
                onClick={() => {
                  setEndSheet(false);
                  void run({ type: "end", closeTask });
                }}
              >
                保存并结束
              </button>
              <button className="h-text" onClick={() => setEndSheet(false)}>
                继续训练
              </button>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
