import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
const folder = path.resolve("node_modules/.cache/journal-tests");
await mkdir(folder, { recursive: true });
await build({
  entryPoints: ["src/services/journal/model.ts"],
  outfile: path.join(folder, "model.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const {
  newJournal,
  validateJournal,
  monthGrid,
  monthRange,
  journalHasContent,
  compareJournal,
  matchesJournal,
  journalTitle,
} = createRequire(import.meta.url)(path.join(folder, "model.cjs"));
const record = (extra = {}) => ({
  ...newJournal("2026-01-01").entry,
  ...extra,
});
test("journal accepts image-only, reflection-only and rating-only records, rejects metadata-only shells", () => {
  for (const values of [
    { images: ["image"] },
    { reflection: "很放松" },
    { rating: 4 },
    { title: "散步" },
  ]) {
    assert.doesNotThrow(() => validateJournal(record(values)));
    assert.ok(journalHasContent(record(values)));
  }
  assert.throws(
    () => validateJournal(record({ location_text: "贵阳", tags: ["旅行"] })),
    /写点内容/,
  );
});
test("journal backdating remains a natural date independently from creation timestamp and timezone", () => {
  const e = record({
    description: "补记",
    event_timezone: "Asia/Shanghai",
    created_at: "2026-01-02T01:00:00Z",
  });
  validateJournal(e);
  assert.equal(e.event_date, "2026-01-01");
  assert.ok(matchesJournal(e, { date: "2026-01-01" }));
  assert.ok(!matchesJournal(e, { date: "2026-01-02" }));
});
test("journal rejects invalid dates, future dates, duplicate images and invalid optional ratings", () => {
  for (const extra of [
    { event_date: "2026-02-30" },
    { event_date: "2999-01-01" },
    { images: ["x", "x"] },
    { rating: 0 },
    { rating: 2.5 },
    { event_time: "26:01" },
    { tags: Array(11).fill("旅行") },
  ])
    assert.throws(() =>
      validateJournal(record({ description: "a", ...extra })),
    );
});
test("calendar covers complete Monday-first weeks including leap day", () => {
  assert.equal(monthRange("2024-02").to, "2024-02-29");
  const grid = monthGrid("2026-02");
  assert.equal(new Date(grid[0] + "T12:00:00Z").getUTCDay(), 1);
  assert.equal(grid.length % 7, 0);
  assert.ok(grid.includes("2026-02-28"));
});
test("journal search combines date, book, Chinese remarks, images and rating independently of tasks", () => {
  const e = record({
    book_id: "travel",
    description: "参观博物馆",
    reflection: "有趣",
    location_text: "贵阳",
    rating: 4,
    images: ["a"],
  });
  assert.ok(
    matchesJournal(e, {
      query: "有趣",
      book_id: "travel",
      has_images: true,
      min_rating: 3,
      max_rating: 5,
    }),
  );
  assert.ok(!matchesJournal(e, { query: "采购" }));
  assert.ok(!matchesJournal(e, { trash: true }));
  assert.ok(!("quadrant" in e));
  assert.ok(!("status" in e));
});
test("chronological ordering places known times first and undated-time entries after them", () => {
  const a = record({ event_time: null }),
    b = record({ event_time: "19:00" }),
    c = record({ event_time: "09:00" });
  assert.deepEqual(
    [a, b, c].sort(compareJournal).map((e) => e.event_time),
    ["09:00", "19:00", null],
  );
  assert.equal(journalTitle(record({ images: ["a"] })), "照片记录");
});
