import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Scale, Moon, Utensils } from "lucide-react";
import {
  HealthEntity,
  FoodSnapshot,
  entity,
  healthDay,
  intakeKcal,
  previousWeight,
  IntakeRecord,
} from "../../services/health/model";
import { commitHealth } from "../../services/health/store";
import { commonFoods, foodIcon, searchFoods } from "../../services/health/food";
export type RecordKind = "weight" | "intake" | "sleep";
function localStamp(at: string) {
  const d = new Date(at);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function enteredNumber(value: string, allowZero = false) {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0))
    throw Error("请输入有效数值");
  return n;
}
export function HealthRecordEditor(p: {
  kind: RecordKind;
  records: HealthEntity[];
  day: string;
  draft: HealthEntity | null;
  record?: HealthEntity | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const actual = p.record?.body;
  const sourceDraft =
    p.draft && (p.draft.body.record_id || null) === (p.record?.id || null)
      ? p.draft
      : null;
  const draft =
    sourceDraft?.body ||
    (actual
      ? {
          date: p.record!.day,
          time: actual.occurred_at
            ? localStamp(actual.occurred_at).slice(11)
            : "",
          weight: actual.kg === undefined ? "" : String(actual.kg),
          unit: "kg",
          query: actual.food?.name || "",
          food: actual.food || null,
          grams: actual.grams === null ? "" : String(actual.grams ?? ""),
          meal: actual.meal,
          start: actual.start ? localStamp(actual.start) : undefined,
          end: actual.end ? localStamp(actual.end) : undefined,
          note: actual.note,
        }
      : {});
  const baseVersion = useRef(
    sourceDraft?.body.base_version ?? p.record?.version ?? 0,
  );
  const [date, setDate] = useState(draft.date || p.day),
    [time, setTime] = useState(
      draft.time || new Date().toTimeString().slice(0, 5),
    ),
    [weight, setWeight] = useState(draft.weight || ""),
    [unit, setUnit] = useState<"kg" | "jin">(draft.unit || "kg");
  const at = date + "T" + time,
    previous = Number.isFinite(Date.parse(at))
      ? previousWeight(p.records, new Date(at).toISOString())
      : null;
  const [query, setQuery] = useState(draft.query || ""),
    [food, setFood] = useState<FoodSnapshot | null>(draft.food || null),
    [foods, setFoods] = useState<FoodSnapshot[]>([]),
    [grams, setGrams] = useState(draft.grams || ""),
    [kcal100, setKcal100] = useState(draft.kcal100 || ""),
    [meal, setMeal] = useState(draft.meal || "午餐"),
    [state, setState] = useState(draft.state || "状态未注明");
  const [start, setStart] = useState(draft.start || date + "T00:00"),
    [end, setEnd] = useState(draft.end || date + "T08:00"),
    [note, setNote] = useState(draft.note || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [initialized, setInitialized] = useState(false),
    [rulerAnchor, setRulerAnchor] = useState(
      Number(draft.weight) / (draft.unit === "jin" ? 2 : 1) || 60,
    );
  const lock = useRef(false),
    saved = useRef(false),
    search = useRef<AbortController | null>(null),
    latest = useRef<any>(null),
    draftId = useRef(
      sourceDraft?.id || "draft-" + p.kind + "-" + (p.record?.id || "new"),
    );
  latest.current = {
    date,
    time,
    weight,
    unit,
    query,
    food,
    grams,
    kcal100,
    meal,
    state,
    start,
    end,
    note,
  };
  useEffect(() => {
    if (!initialized) {
      if (!weight && previous) {
        setWeight(String(previous.body.kg * (unit === "jin" ? 2 : 1)));
        setRulerAnchor(previous.body.kg);
      }
      setInitialized(true);
    }
  }, [initialized, previous]);
  const meaningful = () =>
    !!(
      latest.current.weight ||
      latest.current.query ||
      latest.current.note ||
      latest.current.food ||
      latest.current.start !== date + "T00:00" ||
      latest.current.end !== date + "T08:00"
    );
  const saveDraft = async (closing = false) => {
    if (saved.current || (lock.current && !closing) || !meaningful()) return;
    await commitHealth((s) => {
      const old = s.records.find((r) => r.id === draftId.current);
      return [
        {
          ...(old || entity("draft", {}, date, draftId.current)),
          day: date,
          deleted_at: null,
          body: {
            ...latest.current,
            record_kind: p.kind,
            record_id: p.record?.id || null,
            base_version: baseVersion.current,
          },
        },
      ];
    });
  };
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void handlers.current
          .saveDraft()
          .catch((e) => setError((e as Error).message)),
      800,
    );
    return () => clearTimeout(timer);
  }, [
    date,
    time,
    weight,
    unit,
    query,
    food,
    grams,
    kcal100,
    meal,
    state,
    start,
    end,
    note,
  ]);
  const close = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await saveDraft(true);
      p.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const handlers = useRef({ close, saveDraft });
  handlers.current = { close, saveDraft };
  useEffect(() => {
    const back = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      void handlers.current.close();
    };
    const hide = () => {
      if (document.hidden) void handlers.current.saveDraft().catch(() => {});
    };
    window.addEventListener("todotree:back", back, true);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("todotree:back", back, true);
      document.removeEventListener("visibilitychange", hide);
      search.current?.abort();
    };
  }, []);
  const find = async () => {
    if (searching) return;
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setSearching(true);
    setError("");
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      setFoods(await searchFoods(query, controller.signal));
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "查询超时，可继续手动记录"
          : (e as Error).message,
      );
    } finally {
      clearTimeout(timer);
      setSearching(false);
    }
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let record: HealthEntity;
      if (
        p.kind !== "sleep" &&
        (!Number.isFinite(Date.parse(at)) || date > healthDay())
      )
        throw Error("填写有效的实际日期与时间");
      if (
        p.kind === "sleep" &&
        (!Number.isFinite(Date.parse(start)) ||
          !Number.isFinite(Date.parse(end)) ||
          healthDay(new Date(end)) > healthDay())
      )
        throw Error("填写有效的实际睡眠起止时间");
      if (p.kind === "weight") {
        const entered = enteredNumber(weight);
        if (entered === null) throw Error("填写实际测量值");
        const kg = Math.round((entered / (unit === "jin" ? 2 : 1)) * 100) / 100;
        record = entity(
          "weight",
          {
            kg,
            occurred_at: new Date(at).toISOString(),
            note,
            source: "manual",
          },
          date,
        );
      } else if (p.kind === "sleep") {
        record = entity(
          "sleep",
          {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            note,
            source: "manual",
          },
          healthDay(new Date(end)),
        );
      } else {
        const nutrition: FoodSnapshot = food || {
          id: "manual-" + crypto.randomUUID(),
          name: query.trim(),
          state,
          source: kcal100.trim() ? "用户输入（包装或配方）" : "未提供营养数据",
          source_url: null,
          source_id: null,
          kcal_per_100g: enteredNumber(kcal100, true),
          captured_at: new Date().toISOString(),
          data_type: "manual",
        };
        const g = enteredNumber(grams);
        record = entity(
          "intake",
          {
            meal,
            food: nutrition,
            grams: g,
            kcal: intakeKcal(nutrition, g),
            occurred_at: new Date(at).toISOString(),
            note,
          } as IntakeRecord,
          date,
        );
      }
      if (p.record)
        record = {
          ...record,
          id: p.record.id,
          version: baseVersion.current,
          created_at: p.record.created_at,
        };
      await commitHealth((s) => {
        if (
          p.record &&
          s.records.find((r) => r.id === p.record!.id)?.version !==
            baseVersion.current
        )
          throw Error("原记录已有新修改，草稿已保留。请返回并核对后重新编辑");
        const d = s.records.find((r) => r.id === draftId.current);
        return [
          record,
          ...(d ? [{ ...d, deleted_at: new Date().toISOString() }] : []),
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
  const kg = Number(weight) / (unit === "jin" ? 2 : 1),
    delta = previous && weight ? kg - previous.body.kg : null;
  const selectedFood =
    food ||
    ({
      kcal_per_100g: kcal100.trim() ? Number(kcal100) : null,
    } as FoodSnapshot);
  const estimate = intakeKcal(
    selectedFood,
    grams.trim() ? Number(grams) : null,
  );
  return (
    <section className="h-editor">
      <header className="h-header">
        <button
          className="h-icon"
          aria-label="返回健康并保留草稿"
          disabled={busy}
          onClick={() => void close()}
        >
          <ArrowLeft />
        </button>
        <div>
          <h1>
            {p.kind === "weight"
              ? "记录体重"
              : p.kind === "sleep"
                ? "记录睡眠"
                : "记录饮食"}
          </h1>
          <small>保存前可调整，未知信息可留空</small>
        </div>
        <button
          className="h-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </header>
      <div className="h-scroll">
        <fieldset disabled={busy}>
          {p.kind !== "sleep" && (
            <div className="h-fields">
              <label>
                实际日期
                <input
                  aria-label="健康记录日期"
                  type="date"
                  max={healthDay()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                实际时间
                <input
                  aria-label="健康记录时间"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            </div>
          )}
          {p.kind === "weight" && (
            <>
              <div className="h-weight-face">
                <Scale size={28} />
                <label>
                  <input
                    aria-label="体重数值"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={weight}
                    onChange={(e) => {
                      setWeight(e.target.value);
                      if (Number(e.target.value) > 0)
                        setRulerAnchor(
                          Number(e.target.value) / (unit === "jin" ? 2 : 1),
                        );
                    }}
                  />
                  <select
                    aria-label="体重单位"
                    value={unit}
                    onChange={(e) => {
                      const u = e.target.value as "kg" | "jin";
                      if (weight)
                        setWeight(
                          (Number(weight) * (u === "jin" ? 2 : 0.5)).toFixed(1),
                        );
                      setUnit(u);
                    }}
                  >
                    <option value="kg">kg</option>
                    <option value="jin">斤</option>
                  </select>
                </label>
                <p
                  className={
                    delta === null ? "" : delta > 0 ? "h-rise" : "h-fall"
                  }
                >
                  {delta === null
                    ? "首次记录，填写实际测量值"
                    : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} kg · 较前次`}
                </p>
                <input
                  className="h-ruler"
                  aria-label="滑动调整体重"
                  type="range"
                  min={Math.max(1, rulerAnchor - 10) * (unit === "jin" ? 2 : 1)}
                  max={
                    Math.min(500, rulerAnchor + 10) * (unit === "jin" ? 2 : 1)
                  }
                  step={unit === "jin" ? ".2" : ".1"}
                  value={weight || 60}
                  onChange={(e) => setWeight(Number(e.target.value).toFixed(1))}
                />
                <div className="h-ruler-marks" aria-hidden="true" />
                <small>
                  {previous
                    ? `前次 ${previous.day} · ${previous.body.kg} kg`
                    : "移动标尺不会自动保存"}
                </small>
              </div>
              <p className="h-muted">
                红绿表示变化方向，保存按钮才会记录本次测量。
              </p>
            </>
          )}
          {p.kind === "sleep" && (
            <>
              <div className="h-sleep-face">
                <Moon size={32} />
                <strong>
                  {Number.isFinite(Date.parse(end) - Date.parse(start)) &&
                  Date.parse(end) > Date.parse(start)
                    ? ((Date.parse(end) - Date.parse(start)) / 3600000).toFixed(
                        1,
                      ) + " 小时"
                    : "填写起止时间"}
                </strong>
                <small>手动记录 · 按结束日归属</small>
              </div>
              <label>
                睡眠开始
                <input
                  aria-label="睡眠开始"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                睡眠结束
                <input
                  aria-label="睡眠结束"
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <p className="h-muted">
                可以跨夜或午睡；重复时间段在汇总中只计算一次。
              </p>
            </>
          )}
          {p.kind === "intake" && (
            <>
              <div className="h-meals">
                {["早餐", "午餐", "晚餐", "加餐"].map((m) => (
                  <button
                    key={m}
                    aria-pressed={meal === m}
                    onClick={() => setMeal(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="h-food-search">
                <input
                  aria-label="食物名称"
                  placeholder="搜食物，也可只记录名称"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFood(null);
                  }}
                />
                <button
                  className="h-icon"
                  aria-label="查询食品来源"
                  disabled={searching || !query.trim()}
                  onClick={() => void find()}
                >
                  <Search size={20} />
                </button>
              </div>
              <div className="h-food-chips">
                {commonFoods.slice(0, 6).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setQuery(f);
                      setFood(null);
                    }}
                  >
                    {foodIcon(f)} {f}
                  </button>
                ))}
              </div>
              {searching && <p role="status">正在查询公开食品来源…</p>}
              {foods.length > 0 && (
                <div className="h-food-results">
                  {foods.map((f) => (
                    <button
                      key={f.id}
                      aria-pressed={food?.id === f.id}
                      onClick={() => {
                        setFood(f);
                        setQuery(f.name);
                      }}
                    >
                      <span>{foodIcon(f.name)}</span>
                      <div>
                        <strong>{f.name}</strong>
                        <small>
                          {f.kcal_per_100g === null
                            ? "能量未知"
                            : f.kcal_per_100g + " kcal / 100g"}{" "}
                          · {f.data_type}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!food && (
                <>
                  <label>
                    食物状态 / 做法
                    <input
                      aria-label="食物状态或做法"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                    />
                  </label>
                  <label>
                    每 100g 热量（选填）
                    <input
                      aria-label="每100克热量"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={kcal100}
                      onChange={(e) => setKcal100(e.target.value)}
                      placeholder="依据包装或自己的配方；未知留空"
                    />
                  </label>
                </>
              )}
              <label>
                实际可食克重
                <input
                  aria-label="食物克重"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  placeholder="克，份量未知也可留空"
                />
              </label>
              <div className="h-energy">
                <Utensils size={22} />
                <strong>
                  {estimate === null || !Number.isFinite(estimate)
                    ? "热量未确定"
                    : estimate.toFixed(1) + " kcal"}
                </strong>
              </div>
              {food?.source_url && (
                <a
                  className="h-source"
                  href={food.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 {food.source} 原始条目 ↗
                </a>
              )}
              <p className="h-muted">
                核对生熟 /
                做法是否匹配。没有合适条目时可以直接保存；未知不会当作 0。
              </p>
            </>
          )}
          <label>
            备注（选填）
            <textarea
              aria-label="健康记录备注"
              placeholder="留一句实际情况…"
              value={note}
              maxLength={5000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <p className="h-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
