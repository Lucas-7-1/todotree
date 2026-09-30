import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  Exercise,
  HealthEntity,
  WorkoutTemplate,
  entity,
  healthId,
  validateTemplate,
} from "../../services/health/model";
import { commitHealth } from "../../services/health/store";
import { registerNavigationGuard } from "../../services/navigationGuard";
export function WorkoutEditor(p: {
  record: HealthEntity | null;
  initial: WorkoutTemplate;
  draft?: HealthEntity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<WorkoutTemplate>(
      structuredClone(p.initial),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    lock = useRef(false);
  const draftId = useRef(
      p.draft?.id || "draft-template-" + (p.record?.id || "new"),
    ),
    latest = useRef(value),
    saved = useRef(false),
    baseVersion = useRef(p.draft?.body.base_version ?? p.record?.version ?? 0);
  latest.current = value;
  const saveDraft = async () => {
    if (
      saved.current ||
      lock.current ||
      (JSON.stringify(latest.current) === JSON.stringify(p.initial) && !p.draft)
    )
      return;
    await commitHealth((s) => {
      const old = s.records.find((e) => e.id === draftId.current);
      return [
        {
          ...(old || entity("draft", {})),
          id: draftId.current,
          body: {
            record_kind: "template",
            template_id: p.record?.id || null,
            base_version: baseVersion.current,
            value: latest.current,
          },
          deleted_at: null,
        },
      ];
    });
  };
  const handlers = useRef({ saveDraft });
  handlers.current = { saveDraft };
  useEffect(() => registerNavigationGuard(async () => {
    if (lock.current) return false;
    try { await handlers.current.saveDraft(); }
    catch (e) { setError((e as Error).message); throw e; }
  }), []);
  useEffect(() => {
    const timer = setTimeout(
      () => void handlers.current.saveDraft().catch((e) => setError(e.message)),
      800,
    );
    return () => clearTimeout(timer);
  }, [value]);
  const close = async () => {
    if (lock.current) return;
    try {
      await saveDraft();
      p.onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const back = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      void closeRef.current();
    };
    const hide = () => {
      if (document.hidden) void handlers.current.saveDraft().catch(() => {});
    };
    window.addEventListener("todotree:back", back, true);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("todotree:back", back, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const change = (id: string, patch: Partial<Exercise>) =>
    setValue((v) => ({
      ...v,
      exercises: v.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      validateTemplate(value);
      await commitHealth((s) => {
        const old = p.record
          ? s.records.find((e) => e.id === p.record!.id)
          : null;
        if (p.record && old?.version !== baseVersion.current)
          throw Error("原模板已有新修改，草稿已保留。请返回并核对后重新编辑");
        const draft = s.records.find((e) => e.id === draftId.current);
        return [
          old ? { ...old, body: value } : entity("template", value),
          ...(draft
            ? [{ ...draft, deleted_at: new Date().toISOString() }]
            : []),
        ];
      });
      saved.current = true;
      p.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="h-editor">
      <header className="h-header">
        <button
          className="h-icon"
          aria-label="返回训练模板"
          disabled={busy}
          onClick={() => void close()}
        >
          <ArrowLeft />
        </button>
        <div>
          <h1>{p.record ? "编辑模板" : "创建训练模板"}</h1>
          <small>修改不会影响历史或本次训练</small>
        </div>
        <button
          className="h-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          保存
        </button>
      </header>
      <div className="h-scroll">
        <fieldset disabled={busy}>
          <label>
            模板名称
            <input
              aria-label="训练模板名称"
              value={value.title}
              maxLength={100}
              onChange={(e) =>
                setValue((v) => ({ ...v, title: e.target.value }))
              }
            />
          </label>
          {value.exercises.map((e, i) => (
            <section className="h-exercise-editor" key={e.id}>
              <div className="h-section-heading">
                <h2>动作 {i + 1}</h2>
                <button
                  className="h-icon"
                  aria-label={`删除动作 ${i + 1}`}
                  onClick={() =>
                    setValue((v) => ({
                      ...v,
                      exercises: v.exercises.filter((x) => x.id !== e.id),
                    }))
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <label>
                动作名称
                <input
                  aria-label={`动作名称 ${i + 1}`}
                  value={e.name}
                  onChange={(ev) => change(e.id, { name: ev.target.value })}
                />
              </label>
              <div className="h-fields">
                <label>
                  组数
                  <input
                    aria-label={`组数 ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="50"
                    value={e.sets}
                    onChange={(ev) =>
                      change(e.id, { sets: Number(ev.target.value) })
                    }
                  />
                </label>
                <label>
                  每组次数
                  <input
                    aria-label={`每组次数 ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000"
                    value={e.reps}
                    onChange={(ev) =>
                      change(e.id, { reps: Number(ev.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="h-fields">
                <label>
                  负重 kg
                  <input
                    aria-label={`负重 ${i + 1}`}
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={e.load_kg ?? ""}
                    placeholder="自重留空"
                    onChange={(ev) =>
                      change(e.id, {
                        load_kg: ev.target.value
                          ? Number(ev.target.value)
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  负重口径
                  <select
                    aria-label={`负重口径 ${i + 1}`}
                    value={e.load_basis}
                    onChange={(ev) =>
                      change(e.id, { load_basis: ev.target.value as any })
                    }
                  >
                    <option value="bodyweight">自重</option>
                    <option value="total">总重量</option>
                    <option value="each">单只重量</option>
                    <option value="assistance">助力重量</option>
                  </select>
                </label>
              </div>
              <label>
                组间休息（秒）
                <input
                  aria-label={`休息秒数 ${i + 1}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="3600"
                  value={e.rest_seconds}
                  onChange={(ev) =>
                    change(e.id, { rest_seconds: Number(ev.target.value) })
                  }
                />
              </label>
            </section>
          ))}
          <button
            className="h-text"
            onClick={() =>
              setValue((v) => ({
                ...v,
                exercises: [
                  ...v.exercises,
                  {
                    id: healthId(),
                    name: "",
                    sets: 3,
                    reps: 10,
                    load_kg: null,
                    load_basis: "bodyweight",
                    rest_seconds: 60,
                  },
                ],
              }))
            }
          >
            <Plus size={18} /> 添加动作
          </button>
          {error && (
            <p className="h-error" role="alert">
              {error}
            </p>
          )}
        </fieldset>
      </div>
    </section>
  );
}
