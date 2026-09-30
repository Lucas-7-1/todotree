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
  FoodQuantity,
  recipeFood,
} from "../../services/health/model";
import { commitHealth } from "../../services/health/store";
import { commonFoods, foodIcon, searchFoods, nutritionLabel, FoodProvider } from "../../services/health/food";
import { rememberFood } from "../../services/connections/store";
import { ConnectionsDialog } from "../Connections/ConnectionsPanel";
import { registerNavigationGuard } from "../../services/navigationGuard";
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
          grams: actual.quantity?.amount == null ? (actual.grams == null ? "" : String(actual.grams)) : String(actual.quantity.amount),
          quantityUnit: actual.quantity?.unit || "g",
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
  const recentFoods = p.records.filter(r=>r.kind==='intake'&&!r.deleted_at).sort((a,b)=>b.body.occurred_at.localeCompare(a.body.occurred_at)).map(r=>r.body.food as FoodSnapshot).filter((f,i,rows)=>rows.findIndex(v=>v.id===f.id)===i).slice(0,6);
  const at = date + "T" + time,
    previous = Number.isFinite(Date.parse(at))
      ? previousWeight(p.records, new Date(at).toISOString())
      : null;
  const [provider,setProvider]=useState<FoodProvider>(draft.provider||"local"), [connections,setConnections]=useState(false), [foodNotice,setFoodNotice]=useState("");
  const [query, setQuery] = useState(draft.query || ""),
    [food, setFood] = useState<FoodSnapshot | null>(draft.food || null),
    [foods, setFoods] = useState<FoodSnapshot[]>([]),
    [grams, setGrams] = useState(draft.grams || ""),
    [kcal100, setKcal100] = useState(draft.kcal100 || ""),
    [quantityUnit, setQuantityUnit] = useState<FoodQuantity['unit']>(draft.quantityUnit || 'g'),
    [labelBasis, setLabelBasis] = useState<'100g'|'100ml'|'serving'>(draft.labelBasis || '100g'),
    [energyUnit, setEnergyUnit] = useState<'kcal'|'kJ'>(draft.energyUnit || 'kcal'),
    [servingGrams, setServingGrams] = useState(draft.servingGrams || ''),
    [servingMl, setServingMl] = useState(draft.servingMl || ''),
    [recipeName, setRecipeName] = useState(draft.recipeName || ''),
    [recipeYield, setRecipeYield] = useState(draft.recipeYield || ''),
    [recipeUnit, setRecipeUnit] = useState<'g'|'ml'>(draft.recipeUnit || 'g'),
    [ingredients, setIngredients] = useState<{food:FoodSnapshot;quantity:FoodQuantity}[]>(draft.ingredients || []),
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
    provider,
    food,
    grams,
    kcal100,
    quantityUnit, labelBasis, energyUnit, servingGrams, servingMl, recipeName, recipeYield, recipeUnit, ingredients,
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
    provider,
    food,
    grams,
    kcal100,
    quantityUnit, labelBasis, energyUnit, servingGrams, servingMl, recipeName, recipeYield, recipeUnit, ingredients,
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
  useEffect(() => registerNavigationGuard(async () => {
    if (lock.current) return false;
    try { await handlers.current.saveDraft(true); }
    catch (e) { setError((e as Error).message); throw e; }
  }), []);
  useEffect(() => {
    const back = (e: Event) => {
      if(document.querySelector(".connection-overlay,.place-overlay"))return;
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
      const results=await searchFoods(query, controller.signal,provider);
      if(!controller.signal.aborted){setFoods(results);setFoodNotice(results.length?"请选择与实际食物、状态匹配的条目":"没有匹配结果，仍可直接保存名称与克重");}
    } catch (e) {
      if(search.current===controller&&!controller.signal.aborted)setError((e as Error).message);
    } finally {
      clearTimeout(timer);
      if(search.current===controller)setSearching(false);
    }
  };
  const changeQuery=(value:string)=>{search.current?.abort();setSearching(false);setFoods([]);setQuery(value);setFood(null);setFoodNotice('');};
  const manualFood = ():FoodSnapshot => {
    const entered = enteredNumber(kcal100, true);
    const kcal = entered === null ? null : Math.round(entered / (energyUnit === 'kJ' ? 4.184 : 1) * 100) / 100;
    return { id: 'personal-' + crypto.randomUUID(), name: query.trim(), state,
      provider: 'manual', source: '用户输入（包装标签）', source_url: null, source_id: null,
      kcal_per_100g: labelBasis === '100g' ? kcal : null, label_energy: { kcal, basis: labelBasis },
      serving: { label: '用户确认的一份', grams: enteredNumber(servingGrams), millilitres: enteredNumber(servingMl) },
      captured_at: new Date().toISOString(), data_type: '个人营养标签' };
  };
  const saveLabel=async()=>{
    try { const label = food || manualFood(); if (!label.name) throw Error('先填写食物名称');
      await rememberFood(label); setFood(label); setFoodNotice('已保存个人标签，下次可搜索；不会改变历史饮食记录');
    } catch(e) { setError((e as Error).message); }
  };
  const addIngredient = () => {
    try {
      const snapshot = food || manualFood(); if(!snapshot.name)throw Error('先选择或填写原料');
      if(ingredients.length>=30)throw Error('每份配方最多 30 项原料');
      setIngredients([...ingredients, { food: structuredClone(snapshot), quantity: { amount: enteredNumber(grams), unit: quantityUnit } }]);
      setFoodNotice('已加入配方，请继续补充原料、用油与实际成品量');
    } catch(e) { setError((e as Error).message); }
  };
  const useRecipe = () => {
    try { const result = recipeFood(recipeName, ingredients, enteredNumber(recipeYield) || 0, recipeUnit);
      setFood(result); setQuery(result.name); setQuantityUnit(recipeUnit); setGrams('');
      setFoodNotice(result.recipe?.complete ? '已按原料与实际成品量估算，仍需核对做法和用油' : '部分原料营养或份量未知；配方可保存，热量保持未知');
    } catch(e) { setError((e as Error).message); }
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
        const nutrition: FoodSnapshot = food || manualFood();
        const quantity: FoodQuantity = { amount: enteredNumber(grams), unit: quantityUnit };
        const g = quantityUnit === 'g' ? quantity.amount : null;
        record = entity(
          "intake",
          {
            meal,
            food: nutrition,
            grams: g,
            quantity,
            kcal: intakeKcal(nutrition, g, quantity),
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
  let selectedFood = food;
  if(!selectedFood) { try { selectedFood = manualFood(); } catch { selectedFood = null; } }
  const estimate = selectedFood ? intakeKcal(selectedFood, null, { amount: grams.trim() ? Number(grams) : null, unit: quantityUnit }) : null;
  return (
    <section className="h-editor">
      {connections&&<ConnectionsDialog onClose={()=>setConnections(false)}/>}
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
              <div className="food-source-select"><label>查询来源<select aria-label="食品查询来源" value={provider} onChange={e=>{changeQuery(query);setProvider(e.target.value as FoodProvider);}}><option value="local">常见食材 · USDA 离线参考</option><option value="usda">更多食材 · USDA 在线</option><option value="off">包装条码 · Open Food Facts</option><option value="personal">我的营养标签</option></select></label><button onClick={()=>setConnections(true)}>来源设置</button></div>
              <div className="h-food-search">
                <input
                  aria-label="食物名称"
                  placeholder={provider==="off"?"输入包装条码；也可手动记录名称":"搜食物，也可只记录名称"}
                  value={query}
                  onChange={(e) => {
                    changeQuery(e.target.value);
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
              {!!recentFoods.length&&<details><summary>最近记录的食物</summary><div className="h-food-chips">{recentFoods.map(f=><button key={f.id} onClick={()=>{search.current?.abort();setSearching(false);setFood(structuredClone(f));setQuery(f.name);setQuantityUnit(f.label_energy?.basis==='100ml'?'ml':f.label_energy?.basis==='serving'?'serving':'g');setFoodNotice('使用当时保存的营养快照，请核对本次食物与做法');}}>{foodIcon(f.name)} {f.name}</button>)}</div></details>}
              <div className="h-food-chips">
                {commonFoods.slice(0, 6).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      changeQuery(f);
                    }}
                  >
                    {foodIcon(f)} {f}
                  </button>
                ))}
              </div>
              {foodNotice&&<p className="h-muted" role="status">{foodNotice}</p>}
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
                        if(f.label_energy?.basis === "100ml")setQuantityUnit("ml");
                        if(f.label_energy?.basis === "serving")setQuantityUnit("serving");
                      }}
                    >
                      <span>{foodIcon(f.name)}</span>
                      <div>
                        <strong>{f.name}</strong>
                        <small>
                          {nutritionLabel(f)}{" "}
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
                    营养标签能量（选填）
                    <div className="h-fields"><select aria-label="营养标签基准" value={labelBasis} onChange={e=>setLabelBasis(e.target.value as typeof labelBasis)}><option value="100g">每 100g</option><option value="100ml">每 100ml</option><option value="serving">每份</option></select><select aria-label="能量单位" value={energyUnit} onChange={e=>setEnergyUnit(e.target.value as typeof energyUnit)}><option value="kcal">kcal</option><option value="kJ">kJ</option></select></div>
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
              {food&&<div className="h-muted">{food.brand&&<strong>{food.brand} · </strong>}{nutritionLabel(food)}
                {food.label_energy?.basis === 'unknown' && <label>按实际包装确认能量基准<select aria-label="确认包装营养单位" value="" onChange={e=>{const basis=e.target.value as '100g'|'100ml';if(!basis)return;setFood({...food,state:food.state+' · 用户确认单位',kcal_per_100g:basis==='100g'?food.label_energy!.kcal:null,label_energy:{kcal:food.label_energy!.kcal,basis},data_type:food.data_type+'（用户确认基准）'});setQuantityUnit(basis==='100g'?'g':'ml');}}><option value="">请选择；未确认保持未知</option><option value="100g">每 100g</option><option value="100ml">每 100ml</option></select></label>}
                <button onClick={()=>{setState(food.state);setFood(null);setKcal100('');}}>改用手动营养数据</button></div>}
              <details><summary>每份重量 / 体积（按包装或实测，选填）</summary><div className="h-fields"><label>每份克重<input aria-label="每份克重" type="number" min="0" value={food?.serving?.grams ?? servingGrams} onChange={e=>{setServingGrams(e.target.value);if(food)setFood({...food,serving:{label:food.serving?.label||'用户确认的一份',grams:e.target.value?Number(e.target.value):null,millilitres:food.serving?.millilitres??null}});}}/></label><label>每份毫升<input aria-label="每份毫升" type="number" min="0" value={food?.serving?.millilitres ?? servingMl} onChange={e=>{setServingMl(e.target.value);if(food)setFood({...food,serving:{label:food.serving?.label||'用户确认的一份',grams:food.serving?.grams??null,millilitres:e.target.value?Number(e.target.value):null}});}}/></label></div></details>
              <button onClick={()=>void saveLabel()} disabled={!query.trim()}>收藏这份营养标签</button>
              <label>
                实际可食份量
                <select aria-label="摄入份量单位" value={quantityUnit} onChange={e=>setQuantityUnit(e.target.value as FoodQuantity['unit'])}><option value="g">克 g</option><option value="ml">毫升 ml</option><option value="serving">份</option></select>
                <input
                  aria-label="食物克重"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  placeholder="实际份量，未知可留空"
                />
              </label>
              <details className="h-recipe"><summary>制作自己的配方</summary>
                <p className="h-muted">依次选择原料、填写实际用量并加入。把烹调用油也列入，最后填写实际成品重量或体积。</p>
                <button onClick={addIngredient}>把当前食物和份量加入配方</button>
                {ingredients.map((item,i)=><div className="h-recipe-row" key={i}><strong>{item.food.name}</strong><small>{item.food.state} · {nutritionLabel(item.food)}</small><div className="h-fields"><input aria-label={'配方原料份量'+(i+1)} type="number" min="0" value={item.quantity.amount??''} onChange={e=>setIngredients(ingredients.map((v,j)=>j===i?{...v,quantity:{...v.quantity,amount:e.target.value?Number(e.target.value):null}}:v))}/><select aria-label={'配方原料单位'+(i+1)} value={item.quantity.unit} onChange={e=>setIngredients(ingredients.map((v,j)=>j===i?{...v,quantity:{...v.quantity,unit:e.target.value as FoodQuantity['unit']}}:v))}><option value="g">g</option><option value="ml">ml</option><option value="serving">份</option></select><button onClick={()=>setIngredients(ingredients.filter((_,j)=>i!==j))}>移除</button></div></div>)}
                <label>配方名称<input aria-label="配方名称" maxLength={300} value={recipeName} onChange={e=>setRecipeName(e.target.value)}/></label>
                <div className="h-fields"><label>实际成品量<input aria-label="配方成品量" type="number" min="0" value={recipeYield} onChange={e=>setRecipeYield(e.target.value)}/></label><label>成品单位<select aria-label="配方成品单位" value={recipeUnit} onChange={e=>setRecipeUnit(e.target.value as 'g'|'ml')}><option value="g">g</option><option value="ml">ml</option></select></label></div>
                <button disabled={!ingredients.length} onClick={useRecipe}>计算并使用配方</button>
              </details>
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
