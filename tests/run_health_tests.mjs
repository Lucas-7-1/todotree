import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
const folder = path.resolve("node_modules/.cache/health-tests");
await mkdir(folder, { recursive: true });
await build({
  entryPoints: ["src/services/health/model.ts", "src/services/health/food.ts"],
  outdir: folder,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
});
const require = createRequire(import.meta.url);
const {
  entity,
  validateHealthRecord,
  validateHealthSnapshot,
  emptyHealth,
  intakeKcal,
  previousWeight,
  dailyWeights,
  sleepDuration,
  templateExamples,
  newSession,
  advanceSession,
  restRemaining,
  workoutTask,
  closeWorkoutTask,
  plannedOccurrence,
  planDates,
} = require(path.join(folder, "model.cjs"));
const { parseFoodSearch } = require(path.join(folder, "food.cjs"));
const clock = {
  wall: Date.parse("2026-01-01T10:00:00Z"),
  mono: 1000,
  boot: "test",
};
const template = () => structuredClone(templateExamples[0]);
const session = () => newSession(null, template(), "2026-01-01").body;
test("quick completion after six repetitions saves ten, never sixteen; last set creates no extra rest", () => {
  let s = advanceSession(session(), { type: "start" }, clock);
  for (let i = 0; i < 6; i++) s = advanceSession(s, { type: "rep" }, clock);
  s = advanceSession(s, { type: "finishSet" }, clock);
  assert.equal(s.logs[0].actual, 10);
  assert.equal(s.phase, "rest");
  assert.equal(s.set_index, 1);
  s = advanceSession(s, { type: "restDone" }, clock);
  assert.equal(s.phase, "next");
  assert.equal(advanceSession(s, { type: "rep" }, clock), s);
  s = advanceSession(s, { type: "start" }, clock);
  s = advanceSession(s, { type: "finishSet" }, clock);
  s = advanceSession(s, { type: "restDone" }, clock);
  s = advanceSession(s, { type: "start" }, clock);
  s = advanceSession(s, { type: "finishSet" }, clock);
  assert.equal(s.logs.length, 3);
  assert.equal(s.phase, "finished");
  assert.equal(s.rest, null);
  assert.equal(advanceSession(s, { type: "finishSet" }, clock), s);
});
test("each valid tap records one, target starts rest once and undo restores last set", () => {
  let s = advanceSession(session(), { type: "start" }, clock);
  for (let i = 0; i < 10; i++)
    s = advanceSession(s, { type: "rep", restSeconds: 15 }, clock);
  assert.equal(s.logs.length, 1);
  assert.equal(restRemaining(s.rest, clock), 15000);
  assert.equal(advanceSession(s, { type: "rep" }, clock), s);
  s = advanceSession(s, { type: "undoSet" }, clock);
  assert.equal(s.reps, 9);
  assert.equal(s.logs.length, 0);
  assert.equal(s.phase, "active");
  s = advanceSession(s, { type: "minus" }, clock);
  assert.equal(s.reps, 8);
});
test("monotonic rest survives wall-clock edits, pause/resume and app recreation without writing every frame", () => {
  let s = advanceSession(session(), { type: "start" }, clock);
  s = advanceSession(s, { type: "finishSet" }, clock);
  const changed = { ...clock, wall: clock.wall + 86400000, mono: 11000 };
  assert.equal(restRemaining(s.rest, changed), 50000);
  s = advanceSession(s, { type: "pause" }, changed);
  assert.equal(restRemaining(s.rest, { ...changed, mono: 500000 }), 50000);
  s = advanceSession(
    JSON.parse(JSON.stringify(s)),
    { type: "pause" },
    { ...clock, mono: 500000 },
  );
  assert.equal(restRemaining(s.rest, { ...clock, mono: 510000 }), 40000);
  s = advanceSession(
    s,
    { type: "addRest", seconds: 30 },
    { ...clock, mono: 510000 },
  );
  assert.equal(restRemaining(s.rest, { ...clock, mono: 510000 }), 70000);
  assert.throws(() =>
    advanceSession(s, { type: "addRest", seconds: NaN }, clock),
  );
});
test("early end keeps only actual reps, incomplete task is not automatically closed", () => {
  let s = advanceSession(session(), { type: "start" }, clock);
  s = advanceSession(s, { type: "rep" }, clock);
  s = advanceSession(s, { type: "end", closeTask: false }, clock);
  assert.equal(s.logs[0].actual, 1);
  assert.equal(s.partial, true);
  assert.equal(s.close_task, false);
});
test("planned occurrence and today linkage are idempotent; closing task never creates actual session", () => {
  const plan = entity(
    "plan",
    {
      snapshot: template(),
      template_id: "t",
      template_version: 1,
      start_date: "2026-01-01",
      end_date: null,
      time: null,
      repeat: "daily",
      days: [],
      paused: false,
    },
    "2026-01-01",
    "p",
  );
  assert.deepEqual(planDates(plan, "2026-01-02", "2026-01-03"), [
    "2026-01-02",
    "2026-01-03",
  ]);
  const occ = plannedOccurrence(plan, "2026-01-02"),
    first = workoutTask(occ, []),
    again = workoutTask(occ, first.tasks);
  assert.equal(again.tasks, first.tasks);
  assert.equal(first.task.quadrant, null);
  const done = closeWorkoutTask(first.tasks, first.task.id);
  assert.equal(done[0].status, "done");
  assert.equal(closeWorkoutTask(done, first.task.id), done);
  assert.equal(occ.body.state, "planned");
  assert.equal(plan.body.paused, false);
});
test("weight backdating picks prior measurement and daily trend never fills missing days with zero", () => {
  const w = (id, at, kg) =>
      entity("weight", { kg, occurred_at: at }, at.slice(0, 10), id),
    records = [
      w("first", "2026-01-01T08:00:00Z", 60),
      w("latest", "2026-01-03T09:00:00Z", 59.8),
      w("other", "2026-01-03T08:00:00Z", 59.9),
    ];
  assert.equal(previousWeight(records, "2026-01-02T09:00:00Z").id, "first");
  assert.deepEqual(
    dailyWeights(records).map((r) => r.body.kg),
    [60, 59.8],
  );
});
test("cross-night overlapping sleep is unioned instead of double counted", () => {
  const records = [
    entity(
      "sleep",
      { start: "2026-01-01T23:00:00Z", end: "2026-01-02T08:00:00Z" },
      "2026-01-02",
    ),
    entity(
      "sleep",
      { start: "2026-01-02T07:00:00Z", end: "2026-01-02T09:00:00Z" },
      "2026-01-02",
    ),
  ];
  assert.equal(sleepDuration(records), 10 * 3600000);
});
test("food unknown is not zero; kcal and original source are snapshotted independently of later source updates", () => {
  const food = { name: "鸡胸肉", kcal_per_100g: 165 };
  assert.equal(intakeKcal(food, 150), 247.5);
  assert.equal(intakeKcal({ ...food, kcal_per_100g: null }, 150), null);
  assert.equal(intakeKcal(food, null), null);
  assert.equal(intakeKcal({ ...food, kcal_per_100g: 0 }, 150), 0);
  const parsed = parseFoodSearch({
    foods: [
      {
        fdcId: 42,
        description: "Egg, raw",
        dataType: "Foundation",
        foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 143 }],
      },
      {
        fdcId: 43,
        description: "Unknown",
        dataType: "SR Legacy",
        foodNutrients: [],
      },
    ],
  });
  assert.equal(parsed[0].kcal_per_100g, 143);
  assert.equal(parsed[1].kcal_per_100g, null);
  assert.match(parsed[0].source_url, /42/);
});
test("invalid backups, negative measurements and duplicate facts are rejected without empty replacement", () => {
  assert.throws(() =>
    validateHealthRecord(
      entity(
        "weight",
        { kg: -1, occurred_at: "2026-01-01T00:00:00Z" },
        "2026-01-01",
      ),
    ),
  );
  assert.throws(() =>
    validateHealthRecord(entity("unknown", {}, "2026-01-01")),
  );
  const r = entity(
    "weight",
    { kg: 60, occurred_at: "2026-01-01T00:00:00Z" },
    "2026-01-01",
  );
  assert.throws(() =>
    validateHealthSnapshot({ ...emptyHealth(), records: [r, r] }),
  );
});
test("malformed restored session timers and foreign exercise logs are rejected before rendering", () => {
  let body = advanceSession(session(), { type: "start" }, clock);
  body = advanceSession(body, { type: "finishSet" }, clock);
  const valid = entity("session", body, "2026-01-01");
  validateHealthRecord(valid);
  const badTimer = structuredClone(valid);
  badTimer.body.rest = null;
  assert.throws(() => validateHealthRecord(badTimer));
  const badLog = structuredClone(valid);
  badLog.body.logs[0].exercise_id = "foreign";
  assert.throws(() => validateHealthRecord(badLog));
  const badIndex = structuredClone(valid);
  badIndex.body.logs[0].index = 100;
  assert.throws(() => validateHealthRecord(badIndex));
});
// Test the actual serialized storage service through an Android bridge stub.
const storeFile = path.join(folder, "store.cjs");
await build({
  entryPoints: ["src/services/health/store.ts"],
  outfile: storeFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "health-native-test",
      setup(b) {
        b.onResolve({ filter: /@capacitor\/core/ }, () => ({
          path: "mock-core",
          namespace: "test",
        }));
        b.onResolve({ filter: /native\/platform$/ }, () => ({
          path: "mock-platform",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents:
            args.path === "mock-core"
              ? "export const registerPlugin=()=>globalThis.healthNativeMock;"
              : "export const isAndroid=()=>true;",
          loader: "js",
        }));
      },
    },
  ],
});
function setupStore() {
  delete require.cache[require.resolve(storeFile)];
  let state = emptyHealth();
  const operations = new Map(),
    writes = [];
  globalThis.healthNativeMock = {
    read: async () => structuredClone(state),
    commit: async (op) => {
      if (operations.has(op.operation_id))
        return operations.get(op.operation_id);
      assert.equal(op.expected_revision, state.revision);
      const byId = new Map(state.records.map((r) => [r.id, r]));
      for (const r of op.changes) {
        assert.equal(r.version, (byId.get(r.id)?.version || 0) + 1);
        byId.set(r.id, r);
      }
      const ack = {
        revision: state.revision + 1,
        operation_id: op.operation_id,
        saved_at: new Date().toISOString(),
      };
      state = { ...ack, schema_version: 1, records: [...byId.values()] };
      operations.set(op.operation_id, ack);
      writes.push(op);
      return ack;
    },
  };
  return {
    api: require(storeFile),
    writes,
    state: () => structuredClone(state),
  };
}
test("health native delta includes only changed facts and serializes concurrent commands", async () => {
  const { api, writes } = setupStore();
  const first = entity(
    "weight",
    { kg: 60, occurred_at: "2026-01-01T00:00:00Z" },
    "2026-01-01",
  );
  await api.commitHealth(() => [first]);
  await Promise.all([
    api.commitHealth((s) => [
      { ...s.records[0], body: { ...s.records[0].body, kg: 59.9 } },
    ]),
    api.commitHealth(() => [
      entity(
        "sleep",
        { start: "2026-01-01T23:00:00Z", end: "2026-01-02T07:00:00Z" },
        "2026-01-02",
      ),
    ]),
  ]);
  assert.deepEqual(
    writes.map((w) => w.expected_revision),
    [0, 1, 2],
  );
  assert.deepEqual(
    writes.map((w) => w.changes.length),
    [1, 1, 1],
  );
  assert.equal((await api.readHealth()).records.length, 2);
});
test("lost native acknowledgement retries the same operation once without duplicate training facts", async () => {
  const { api, writes } = setupStore(),
    send = globalThis.healthNativeMock.commit;
  globalThis.healthNativeMock.commit = async (op) => {
    await send(op);
    throw Error("ack lost");
  };
  await assert.rejects(
    api.commitHealth(() => [
      entity(
        "weight",
        { kg: 60, occurred_at: "2026-01-01T00:00:00Z" },
        "2026-01-01",
      ),
    ]),
  );
  assert.equal(api.hasPendingHealthSave(), true);
  await assert.rejects(api.commitHealth(() => []));
  globalThis.healthNativeMock.commit = send;
  await api.retryHealthSave();
  assert.equal(writes.length, 1);
  assert.equal((await api.readHealth()).records.length, 1);
});
test("a corrupted native read is never replaced by an empty health database", async () => {
  const { api, writes } = setupStore();
  globalThis.healthNativeMock.read = async () => ({
    schema_version: 999,
    records: [],
  });
  await assert.rejects(api.readHealth());
  await assert.rejects(api.commitHealth(() => []));
  assert.equal(writes.length, 0);
});
test("health export and import preserve source snapshots and do not overwrite conflicting live records", async () => {
  const { api } = setupStore();
  await api.commitHealth(() => [
    entity(
      "weight",
      { kg: 60, occurred_at: "2026-01-01T00:00:00Z" },
      "2026-01-01",
      "weight",
    ),
  ]);
  const backup = JSON.parse(await api.exportHealth());
  backup.records[0].body.kg = 99;
  const result = await api.importHealth(backup);
  assert.equal(result.conflicts, 1);
  assert.equal((await api.readHealth()).records[0].body.kg, 60);
  await assert.rejects(api.importHealth({ format: "bad" }));
  assert.equal((await api.readHealth()).records.length, 1);
});
test("backup import preserves a valid future-dated historical fact after clock rollback", async () => {
  const { api } = setupStore();
  const record = entity(
    "weight",
    { kg: 60, occurred_at: "2099-01-01T00:00:00Z" },
    "2099-01-01",
    "historical",
  );
  await assert.rejects(api.commitHealth(() => [record]));
  assert.equal((await api.readHealth()).records.length, 0);
  const result = await api.importHealth({
    format: "todotree-health",
    schema_version: 1,
    records: [record],
  });
  assert.equal(result.added, 1);
  assert.equal((await api.readHealth()).records[0].id, "historical");
});
