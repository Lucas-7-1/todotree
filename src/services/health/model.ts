import { TaskNode } from "../../types/todo";
import { createTaskRecord } from "../mobileTasks";
import { completeTaskBranch } from "../taskLifecycle";

export type HealthKind =
  | "weight"
  | "sleep"
  | "intake"
  | "template"
  | "plan"
  | "occurrence"
  | "session"
  | "outbox"
  | "draft";
export interface HealthEntity {
  id: string;
  kind: HealthKind;
  day: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
  body: any;
}
export interface HealthSnapshot {
  schema_version: 1;
  revision: number;
  saved_at: string;
  operation_id: string;
  records: HealthEntity[];
}
export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  load_kg: number | null;
  load_basis: "bodyweight" | "total" | "each" | "assistance";
  rest_seconds: number;
}
export interface WorkoutTemplate {
  title: string;
  exercises: Exercise[];
}
export interface WorkoutOccurrence {
  template_id: string;
  template_version: number;
  snapshot: WorkoutTemplate;
  task_id: string | null;
  plan_id: string | null;
  time: string | null;
  state: "planned" | "closed" | "performed";
}
export interface SetLog {
  exercise_id: string;
  index: number;
  target: number;
  actual: number;
  load_kg: number | null;
  load_basis: Exercise["load_basis"];
  completed_at: string;
}
export interface HealthClock {
  wall: number;
  mono: number;
  boot: string;
}
export interface RestState {
  deadline_wall: number;
  deadline_mono: number;
  boot: string;
  paused: boolean;
  remaining_ms: number;
}
export interface WorkoutSession {
  occurrence_id: string | null;
  snapshot: WorkoutTemplate;
  phase: "ready" | "active" | "rest" | "next" | "finished";
  exercise_index: number;
  set_index: number;
  reps: number;
  logs: SetLog[];
  rest: RestState | null;
  started_at: string;
  finished_at: string | null;
  partial: boolean;
  close_task: boolean;
  clock_warning?: boolean;
}
export interface FoodQuantity { amount: number | null; unit: 'g' | 'ml' | 'serving' }
export interface FoodSnapshot {
  id: string;
  name: string;
  state: string;
  kcal_per_100g: number | null;
  source: string;
  source_url: string | null;
  source_id: string | null;
  captured_at: string;
  data_type: string;
  provider?: 'usda' | 'off' | 'manual' | 'recipe';
  source_version?: string;
  brand?: string;
  barcode?: string;
  label_energy?: { kcal: number | null; basis: '100g' | '100ml' | 'serving' | 'unknown' };
  serving?: { label: string; grams: number | null; millilitres: number | null };
  recipe?: { ingredients: { food: FoodSnapshot; quantity: FoodQuantity; kcal: number | null }[]; yield: { amount: number; unit: 'g' | 'ml' }; complete: boolean };
  license_url?: string;
}
export interface IntakeRecord {
  meal: string;
  food: FoodSnapshot;
  grams: number | null;
  quantity?: FoodQuantity;
  kcal: number | null;
  occurred_at: string;
  note: string;
}
export const emptyHealth = (): HealthSnapshot => ({
  schema_version: 1,
  revision: 0,
  saved_at: "",
  operation_id: "init",
  records: [],
});
export const healthId = () => crypto.randomUUID();
export function healthDay(
  time = new Date(),
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
export function entity(
  kind: HealthKind,
  body: any,
  day = healthDay(),
  id: string = healthId(),
): HealthEntity {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    day,
    created_at: now,
    updated_at: now,
    version: 0,
    deleted_at: null,
    body,
  };
}
export function validDay(day: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day + "T12:00:00Z").toISOString().slice(0, 10) === day
  );
}
export function validateTemplate(t: WorkoutTemplate) {
  if (
    !t.title?.trim() ||
    t.title.length > 100 ||
    !Array.isArray(t.exercises) ||
    !t.exercises.length ||
    t.exercises.length > 30
  )
    throw Error("写一个名称，并添加至少一个动作");
  const ids = new Set<string>();
  for (const e of t.exercises) {
    if (!e.id || ids.has(e.id) || !e.name?.trim())
      throw Error("动作名称或编号无效");
    ids.add(e.id);
    if (
      !Number.isInteger(e.sets) ||
      e.sets < 1 ||
      e.sets > 50 ||
      !Number.isInteger(e.reps) ||
      e.reps < 1 ||
      e.reps > 1000
    )
      throw Error("组数 1–50，每组次数 1–1000");
    if (
      !Number.isInteger(e.rest_seconds) ||
      e.rest_seconds < 0 ||
      e.rest_seconds > 3600
    )
      throw Error("休息设置为 0–3600 秒");
    if (
      e.load_kg !== null &&
      (!Number.isFinite(e.load_kg) || e.load_kg < 0 || e.load_kg > 1000)
    )
      throw Error("负重无效");
    if (!["bodyweight", "total", "each", "assistance"].includes(e.load_basis))
      throw Error("选择正确的负重口径");
  }
}
export function validateHealthRecord(e: HealthEntity) {
  if (
    ![
      "weight",
      "sleep",
      "intake",
      "template",
      "plan",
      "occurrence",
      "session",
      "outbox",
      "draft",
    ].includes(e.kind) ||
    !e.id ||
    !Number.isFinite(Date.parse(e.created_at)) ||
    !Number.isFinite(Date.parse(e.updated_at)) ||
    !validDay(e.day) ||
    !Number.isInteger(e.version) ||
    e.version < 0 ||
    !e.body
  )
    throw Error("健康记录格式无效");
  if (e.deleted_at !== null && !Number.isFinite(Date.parse(e.deleted_at)))
    throw Error("健康记录删除时间无效");
  const b = e.body;
  if (
    e.kind === "weight" &&
    (!Number.isFinite(b.kg) ||
      b.kg <= 0 ||
      b.kg > 500 ||
      !Number.isFinite(Date.parse(b.occurred_at)))
  )
    throw Error("请输入有效体重和测量时间");
  if (
    e.kind === "sleep" &&
    (!Number.isFinite(Date.parse(b.start)) ||
      !Number.isFinite(Date.parse(b.end)) ||
      Date.parse(b.end) <= Date.parse(b.start))
  )
    throw Error("结束时间须晚于开始时间，可记录跨夜睡眠");
  if (e.kind === "intake") {
    validateFood(b.food);
    if (b.quantity) {
      validateQuantity(b.quantity);
      if (b.grams !== (b.quantity.unit === 'g' ? b.quantity.amount : null)) throw Error('摄入单位与保存的克重不一致');
    }
    if (
      !b.food?.name?.trim() ||
      (b.grams !== null && (!Number.isFinite(b.grams) || b.grams <= 0))
    )
      throw Error("食物名称或克重无效");
    if (
      b.food.kcal_per_100g !== null &&
      (!Number.isFinite(b.food.kcal_per_100g) || b.food.kcal_per_100g < 0)
    )
      throw Error("每 100g 能量无效");
    if (b.kcal !== intakeKcal(b.food, b.grams, b.quantity))
      throw Error("摄入热量与保存的营养快照不一致");
    if (
      !Number.isFinite(Date.parse(b.occurred_at)) ||
      (b.food.source_url !== null && !/^https?:\/\//i.test(b.food.source_url))
    )
      throw Error("食物记录时间或来源链接无效");
  }
  if (e.kind === "template") validateTemplate(b);
  if (e.kind === "plan") {
    validateTemplate(b.snapshot);
    if (
      !validDay(b.start_date) ||
      (b.end_date !== null &&
        (!validDay(b.end_date) || b.end_date < b.start_date)) ||
      !["once", "daily", "weekly"].includes(b.repeat) ||
      !Array.isArray(b.days) ||
      b.days.some((d: number) => !Number.isInteger(d) || d < 1 || d > 7) ||
      (b.repeat === "weekly" && !b.days.length) ||
      typeof b.paused !== "boolean"
    )
      throw Error("训练计划格式无效");
  }
  if (
    e.kind === "outbox" &&
    (!["create", "complete"].includes(b.type) ||
      !b.occurrence_id ||
      !["pending", "done"].includes(b.status) ||
      !Number.isInteger(b.attempts) ||
      b.attempts < 0)
  )
    throw Error("待办同步记录无效");
  if (e.kind === "draft") {
    if (
      !["weight", "sleep", "intake", "template"].includes(b.record_kind) ||
      !Number.isInteger(b.base_version) ||
      b.base_version < 0
    )
      throw Error("健康草稿类型或版本无效");
    if (
      b.record_kind === "template" &&
      (!b.value ||
        typeof b.value.title !== "string" ||
        !Array.isArray(b.value.exercises) ||
        b.value.exercises.some(
          (x: Exercise) =>
            !x || typeof x.id !== "string" || typeof x.name !== "string",
        ))
    )
      throw Error("模板草稿结构无效");
  }
  if (e.kind === "occurrence") {
    validateTemplate(b.snapshot);
    if (!["planned", "closed", "performed"].includes(b.state))
      throw Error("训练安排状态无效");
  }
  if (e.kind === "session") {
    validateTemplate(b.snapshot);
    if (
      !["ready", "active", "rest", "next", "finished"].includes(b.phase) ||
      !Array.isArray(b.logs) ||
      !Number.isInteger(b.reps) ||
      b.reps < 0
    )
      throw Error("训练状态无效");
    const exercise = b.snapshot.exercises[b.exercise_index];
    if (
      !Number.isInteger(b.exercise_index) ||
      !exercise ||
      !Number.isInteger(b.set_index) ||
      b.set_index < 0 ||
      b.set_index >= exercise.sets ||
      b.reps > 1000
    )
      throw Error("当前训练组无效");
    if (
      !Number.isFinite(Date.parse(b.started_at)) ||
      typeof b.partial !== "boolean" ||
      typeof b.close_task !== "boolean" ||
      (b.phase === "finished"
        ? !Number.isFinite(Date.parse(b.finished_at))
        : b.finished_at !== null)
    )
      throw Error("训练完成状态无效");
    if (b.phase === "rest") {
      const r = b.rest;
      if (
        !r ||
        !Number.isFinite(r.deadline_wall) ||
        !Number.isFinite(r.deadline_mono) ||
        !Number.isFinite(r.remaining_ms) ||
        r.remaining_ms < 0 ||
        typeof r.paused !== "boolean" ||
        typeof r.boot !== "string" ||
        !r.boot
      )
        throw Error("训练休息计时数据无效");
    } else if (b.rest !== null) throw Error("训练状态与休息计时不一致");
    const seen = new Set<string>();
    for (const l of b.logs) {
      const key = l.exercise_id + ":" + l.index,
        target = b.snapshot.exercises.find(
          (x: Exercise) => x.id === l.exercise_id,
        );
      if (
        !target ||
        seen.has(key) ||
        !Number.isInteger(l.index) ||
        l.index < 0 ||
        l.index >= target.sets ||
        l.target !== target.reps ||
        !Number.isInteger(l.actual) ||
        l.actual < 0 ||
        l.actual > 1000 ||
        !Number.isFinite(Date.parse(l.completed_at)) ||
        l.load_basis !== target.load_basis ||
        l.load_kg !== target.load_kg
      )
        throw Error("每组实际记录无效或重复");
      seen.add(key);
    }
  }
}
export function validateHealthSnapshot(s: HealthSnapshot) {
  if (
    !s ||
    s.schema_version !== 1 ||
    !Number.isInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.records)
  )
    throw Error("健康数据无法读取，原数据未覆盖");
  const ids = new Set<string>();
  for (const e of s.records) {
    if (ids.has(e.id)) throw Error("健康记录编号重复");
    ids.add(e.id);
    validateHealthRecord(e);
  }
}
export function validateQuantity(q: FoodQuantity) {
  if (!q || !['g', 'ml', 'serving'].includes(q.unit) || (q.amount !== null && (!Number.isFinite(q.amount) || q.amount <= 0))) throw Error('实际份量无效，未知可留空');
}
export function validateFood(food: FoodSnapshot, depth = 0) {
  if (!food || typeof food.name !== 'string' || !food.name.trim() || food.name.length > 300 || (food.kcal_per_100g !== null && (!Number.isFinite(food.kcal_per_100g) || food.kcal_per_100g < 0 || food.kcal_per_100g > 10000))) throw Error('食品营养快照无效');
  const label = food.label_energy;
  if (label && (!['100g', '100ml', 'serving', 'unknown'].includes(label.basis) || (label.kcal !== null && (!Number.isFinite(label.kcal) || label.kcal < 0)))) throw Error('营养标签单位无效');
  if (label?.basis === '100g' && label.kcal !== food.kcal_per_100g) throw Error('每 100g 营养数据不一致');
  if (label && label.basis !== '100g' && food.kcal_per_100g !== null) throw Error('不同营养单位不能混用');
  if (food.serving && (typeof food.serving.label !== 'string' || food.serving.label.length > 100 || [food.serving.grams, food.serving.millilitres].some(v => v !== null && (!Number.isFinite(v) || v <= 0)))) throw Error('每份的实测重量或体积无效');
  if (food.recipe) {
    const recipe = food.recipe;
    if (depth > 2 || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length || recipe.ingredients.length > 30 || !['g', 'ml'].includes(recipe.yield?.unit) || !Number.isFinite(recipe.yield.amount) || recipe.yield.amount <= 0) throw Error('配方原料或实际成品量无效');
    let total = 0, complete = true;
    for (const item of recipe.ingredients) {
      validateFood(item.food, depth + 1); validateQuantity(item.quantity);
      const kcal = intakeKcal(item.food, null, item.quantity);
      if (kcal !== item.kcal) throw Error('配方原料与营养快照不一致');
      if (kcal === null) complete = false; else total += kcal;
    }
    const rate = complete ? Math.round(total / recipe.yield.amount * 10000) / 100 : null;
    if (recipe.complete !== complete || label?.basis !== ('100' + recipe.yield.unit) || label.kcal !== rate) throw Error('配方估算与实际成品量不一致');
  }
}
export function intakeKcal(food: FoodSnapshot, grams: number | null, quantity?: FoodQuantity) {
  const q = quantity || { amount: grams, unit: 'g' as const };
  if (q.amount === null || !Number.isFinite(q.amount) || q.amount <= 0) return null;
  const label = food.label_energy || { kcal: food.kcal_per_100g, basis: '100g' };
  if (label.kcal === null || label.kcal === undefined || label.basis === 'unknown') return null;
  let amount: number | null = null;
  if (label.basis === '100g') amount = q.unit === 'g' ? q.amount : q.unit === 'serving' && food.serving?.grams ? q.amount * food.serving.grams : null;
  if (label.basis === '100ml') amount = q.unit === 'ml' ? q.amount : q.unit === 'serving' && food.serving?.millilitres ? q.amount * food.serving.millilitres : null;
  if (label.basis === 'serving') amount = q.unit === 'serving' ? q.amount : q.unit === 'g' && food.serving?.grams ? q.amount / food.serving.grams : q.unit === 'ml' && food.serving?.millilitres ? q.amount / food.serving.millilitres : null;
  return amount === null ? null : Math.round(label.kcal * amount * (label.basis === 'serving' ? 100 : 1)) / 100;
}
export function quantityLabel(record: IntakeRecord) {
  const q = record.quantity || { amount: record.grams, unit: 'g' };
  return q.amount === null ? '份量未填' : `${q.amount} ${q.unit === 'serving' ? '份' : q.unit}`;
}
export function recipeFood(name: string, ingredients: { food: FoodSnapshot; quantity: FoodQuantity }[], amount: number, unit: 'g' | 'ml'): FoodSnapshot {
  const items = ingredients.map(item => ({ ...structuredClone(item), kcal: intakeKcal(item.food, null, item.quantity) }));
  const complete = items.every(item => item.kcal !== null);
  const kcal = complete ? Math.round(items.reduce((sum, item) => sum + item.kcal!, 0) / amount * 10000) / 100 : null;
  const food: FoodSnapshot = { id: 'recipe-' + crypto.randomUUID(), name: name.trim(), state: '用户配方 · 估算', provider: 'recipe', source: '用户配方（原料快照与实际成品量）', source_url: null, source_id: null, kcal_per_100g: unit === 'g' ? kcal : null, label_energy: { kcal, basis: unit === 'g' ? '100g' : '100ml' }, captured_at: new Date().toISOString(), data_type: '配方估算', recipe: { ingredients: items, yield: { amount, unit }, complete } };
  validateFood(food); return food;
}
export function previousWeight(records: HealthEntity[], before: string) {
  return (
    records
      .filter(
        (e) =>
          e.kind === "weight" && !e.deleted_at && e.body.occurred_at < before,
      )
      .sort(
        (a, b) =>
          b.body.occurred_at.localeCompare(a.body.occurred_at) ||
          b.created_at.localeCompare(a.created_at),
      )[0] || null
  );
}
export function sleepDuration(records: HealthEntity[]) {
  const intervals = records
    .filter((e) => e.kind === "sleep" && !e.deleted_at)
    .map((e) => [Date.parse(e.body.start), Date.parse(e.body.end)])
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    start = 0,
    end = 0;
  for (const [s, t] of intervals) {
    if (s > end) {
      total += Math.max(0, end - start);
      start = s;
      end = t;
    } else end = Math.max(end, t);
  }
  return total + Math.max(0, end - start);
}
export function dailyWeights(records: HealthEntity[]) {
  const days = new Map<string, HealthEntity>();
  for (const e of records) {
    if (e.kind !== "weight" || e.deleted_at) continue;
    const prev = days.get(e.day);
    if (!prev || prev.body.occurred_at < e.body.occurred_at) days.set(e.day, e);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export const templateExamples: WorkoutTemplate[] = [
  {
    title: "俯卧撑基础",
    exercises: [
      {
        id: "push-up",
        name: "俯卧撑",
        sets: 3,
        reps: 10,
        load_kg: null,
        load_basis: "bodyweight",
        rest_seconds: 60,
      },
    ],
  },
  {
    title: "自重练习",
    exercises: [
      {
        id: "squat",
        name: "深蹲",
        sets: 3,
        reps: 12,
        load_kg: null,
        load_basis: "bodyweight",
        rest_seconds: 60,
      },
      {
        id: "push-up",
        name: "俯卧撑",
        sets: 3,
        reps: 10,
        load_kg: null,
        load_basis: "bodyweight",
        rest_seconds: 90,
      },
    ],
  },
  {
    title: "哑铃练习",
    exercises: [
      {
        id: "row",
        name: "哑铃划船",
        sets: 3,
        reps: 10,
        load_kg: 5,
        load_basis: "each",
        rest_seconds: 90,
      },
    ],
  },
];
export function planDates(plan: HealthEntity, from: string, to: string) {
  const b = plan.body,
    dates: string[] = [];
  if (b.paused) return dates;
  let date = new Date(
      (from > b.start_date ? from : b.start_date) + "T12:00:00Z",
    ),
    limit = b.end_date && b.end_date < to ? b.end_date : to;
  for (
    let i = 0;
    i < 366 && date.toISOString().slice(0, 10) <= limit;
    i++, date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const day = date.toISOString().slice(0, 10),
      weekday = ((date.getUTCDay() + 6) % 7) + 1;
    if (
      b.repeat === "daily" ||
      (b.repeat === "weekly" && b.days.includes(weekday)) ||
      (b.repeat === "once" && day === b.start_date)
    )
      dates.push(day);
  }
  return dates;
}
export function plannedOccurrence(
  plan: HealthEntity,
  day: string,
): HealthEntity {
  return entity(
    "occurrence",
    {
      template_id: plan.body.template_id,
      template_version: plan.body.template_version,
      snapshot: structuredClone(plan.body.snapshot),
      plan_id: plan.id,
      task_id: null,
      time: plan.body.time || null,
      state: "planned",
    },
    day,
    "occ-" + plan.id + "-" + day,
  );
}
export function workoutTask(occurrence: HealthEntity, tasks: TaskNode[]) {
  const id = "health-task-" + occurrence.id,
    existing = tasks.find((t) => t.id === id);
  if (existing) return { tasks, task: existing };
  const b = occurrence.body as WorkoutOccurrence;
  const t = {
    ...createTaskRecord(
      {
        title: b.snapshot.title,
        parentId: null,
        plannedDate: occurrence.day,
        note: "健康计划 · 本次训练；完成安排不会自动生成实际训练记录",
      },
      occurrence.day,
    ),
    id,
    health_occurrence_id: occurrence.id,
  };
  return { tasks: [...tasks, t], task: t };
}
export function closeWorkoutTask(tasks: TaskNode[], id: string) {
  const t = tasks.find((t) => t.id === id && !t.deleted_at);
  return t?.status === "open" ? completeTaskBranch(tasks, id).tasks : tasks;
}
export function newSession(
  occurrence: HealthEntity | null,
  template: WorkoutTemplate,
  day = healthDay(),
) {
  validateTemplate(template);
  return entity(
    "session",
    {
      occurrence_id: occurrence?.id || null,
      snapshot: structuredClone(template),
      phase: "ready",
      exercise_index: 0,
      set_index: 0,
      reps: 0,
      logs: [],
      rest: null,
      started_at: new Date().toISOString(),
      finished_at: null,
      partial: false,
      close_task: true,
    } as WorkoutSession,
    day,
  );
}
export function restRemaining(rest: RestState, clock: HealthClock) {
  if (rest.paused) return rest.remaining_ms;
  // A changed boot requires explicit recovery instead of trusting a reset monotonic clock.
  return Math.max(
    0,
    rest.boot === clock.boot
      ? rest.deadline_mono - clock.mono
      : rest.deadline_wall - clock.wall,
  );
}
export type SessionAction =
  | { type: "start" }
  | { type: "rep"; restSeconds?: number }
  | { type: "minus" }
  | { type: "finishSet"; actual?: number; restSeconds?: number }
  | { type: "restDone" }
  | { type: "pause" }
  | { type: "addRest"; seconds: number }
  | { type: "end"; closeTask: boolean }
  | { type: "undoSet" };
export function advanceSession(
  source: WorkoutSession,
  action: SessionAction,
  clock: HealthClock,
): WorkoutSession {
  const s = structuredClone(source),
    exercise = s.snapshot.exercises[s.exercise_index];
  if (s.phase === "finished" && action.type !== "undoSet") return source;
  const next = () => {
    if (s.set_index + 1 < exercise.sets) s.set_index++;
    else {
      s.exercise_index++;
      s.set_index = 0;
    }
    s.reps = 0;
  };
  const finish = (actual: number, restSeconds = exercise.rest_seconds) => {
    if (s.phase !== "active") return;
    if (!Number.isInteger(actual) || actual < 0 || actual > 1000)
      throw Error("本组实际次数为 0–1000");
    if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 3600)
      throw Error("休息秒数为 0–3600");
    s.logs.push({
      exercise_id: exercise.id,
      index: s.set_index,
      target: exercise.reps,
      actual,
      load_kg: exercise.load_kg,
      load_basis: exercise.load_basis,
      completed_at: new Date(clock.wall).toISOString(),
    });
    const last =
      s.exercise_index === s.snapshot.exercises.length - 1 &&
      s.set_index === exercise.sets - 1;
    if (last) {
      s.phase = "finished";
      s.finished_at = new Date(clock.wall).toISOString();
      s.partial = false;
      s.rest = null;
      s.reps = actual;
    } else {
      next();
      s.phase = restSeconds ? "rest" : "next";
      s.rest = restSeconds
        ? {
            deadline_wall: clock.wall + restSeconds * 1000,
            deadline_mono: clock.mono + restSeconds * 1000,
            boot: clock.boot,
            paused: false,
            remaining_ms: restSeconds * 1000,
          }
        : null;
    }
  };
  if (action.type === "start" && (s.phase === "ready" || s.phase === "next"))
    s.phase = "active";
  else if (action.type === "rep" && s.phase === "active") {
    s.reps = Math.min(exercise.reps, s.reps + 1);
    if (s.reps === exercise.reps) finish(s.reps, action.restSeconds);
  } else if (action.type === "minus" && s.phase === "active")
    s.reps = Math.max(0, s.reps - 1);
  else if (action.type === "finishSet")
    finish(
      action.actual ?? Math.max(s.reps, exercise.reps),
      action.restSeconds,
    );
  else if (action.type === "restDone" && s.phase === "rest") {
    s.rest = null;
    s.phase = "next";
  } else if (action.type === "pause" && s.phase === "rest" && s.rest) {
    const ms = restRemaining(s.rest, clock);
    s.rest = {
      ...s.rest,
      paused: !s.rest.paused,
      remaining_ms: ms,
      deadline_mono: clock.mono + ms,
      deadline_wall: clock.wall + ms,
      boot: clock.boot,
    };
  } else if (action.type === "addRest" && s.phase === "rest" && s.rest) {
    if (
      !Number.isInteger(action.seconds) ||
      action.seconds < 0 ||
      action.seconds > 3600
    )
      throw Error("追加休息时间无效");
    const ms = Math.max(
      0,
      restRemaining(s.rest, clock) + action.seconds * 1000,
    );
    s.rest = {
      ...s.rest,
      remaining_ms: ms,
      deadline_mono: clock.mono + ms,
      deadline_wall: clock.wall + ms,
      boot: clock.boot,
    };
  } else if (action.type === "end") {
    if (s.phase === "active" && s.reps > 0)
      s.logs.push({
        exercise_id: exercise.id,
        index: s.set_index,
        target: exercise.reps,
        actual: s.reps,
        load_kg: exercise.load_kg,
        load_basis: exercise.load_basis,
        completed_at: new Date(clock.wall).toISOString(),
      });
    s.phase = "finished";
    s.partial = true;
    s.rest = null;
    s.finished_at = new Date(clock.wall).toISOString();
    s.close_task = action.closeTask;
  } else if (action.type === "undoSet" && s.logs.length) {
    const log = s.logs.pop()!;
    s.exercise_index = s.snapshot.exercises.findIndex(
      (e) => e.id === log.exercise_id,
    );
    s.set_index = log.index;
    s.reps = Math.max(0, log.actual - 1);
    s.phase = "active";
    s.rest = null;
    s.finished_at = null;
    s.partial = false;
  }
  return JSON.stringify(s) === JSON.stringify(source) ? source : s;
}
