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
  journalTitle, compareJournalTime, minorAmount, expenseTotals,
} = createRequire(import.meta.url)(path.join(folder, "model.cjs"));
const record = (extra = {}) => ({
  ...newJournal("2026-01-01").entry,
  ...extra,
});
test("journal accepts image-only, reflection-only and rating-only records, accepts location/expense facts and rejects tag-only shells", () => {
  for (const values of [
    { images: ["image"] },
    { reflection: "很放松" },
    { rating: 4 },
    { title: "散步" },
    { location_text: "贵阳" },
    { expense: {id:"a",bill_id:"a",role:"independent",currency:"CNY",amount_minor:0,personal_minor:null} },
  ]) {
    assert.doesNotThrow(() => validateJournal(record(values)));
    assert.ok(journalHasContent(record(values)));
  }
  assert.throws(
    () => validateJournal(record({ tags: ["旅行"] })),
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

await build({entryPoints:['src/services/journal/tree.ts'],outfile:path.join(folder,'tree.cjs'),bundle:true,platform:'node',format:'cjs'});
const {journalIndex,planJournalMove}=createRequire(import.meta.url)(path.join(folder,'tree.cjs'));
const node=(id,parent_id=null,extra={})=>record({id,parent_id,title:id,version:1,sort_order:1024,...extra});
test('journal tree move preserves the whole subtree, dates and attachments while allowing nesting and promotion',()=>{
  const a=node('a'),b=node('b'),c=node('c','a',{event_date:'2026-01-02',images:['photo']}),d=node('d','c');
  const rows=[a,b,c,d],plan=planJournalMove(rows,{id:'c',parent_id:'b',book_id:'daily',expected_version:1});
  const moved=rows.map(e=>plan.after.find(p=>p.id===e.id)||e);
  assert.equal(journalIndex(moved).path('d').map(e=>e.id).join('/'),'b/c');
  assert.equal(moved.find(e=>e.id==='c').event_date,'2026-01-02');
  assert.deepEqual(moved.find(e=>e.id==='c').images,['photo']);
  assert.equal(plan.after.length,1);
  const promoted=planJournalMove(moved,{id:'c',parent_id:null,book_id:'travel',expected_version:2});
  assert.ok(promoted.after.every(e=>e.book_id==='travel'));
  assert.equal(promoted.after.find(e=>e.id==='c').parent_id,null);
  assert.equal(promoted.after.find(e=>e.id==='d').parent_id,'c');
});
test('journal tree rejects hidden descendant cycles, sixth level and stale moves',()=>{
  const rows=[node('a'),node('b','a'),node('c','b'),node('d','c'),node('e','d'),node('x')];
  assert.throws(()=>planJournalMove(rows,{id:'a',parent_id:'e',book_id:'daily',expected_version:1}),/自身/);
  assert.throws(()=>planJournalMove(rows,{id:'x',parent_id:'e',book_id:'daily',expected_version:1}),/5 层/);
  assert.throws(()=>planJournalMove(rows,{id:'x',parent_id:'b',book_id:'daily',expected_version:0}),/已变化/);
  assert.throws(()=>journalIndex([node('orphan','missing')]).validate(),/不存在/);
});
test('journal sibling reorder affects neither completion nor historical calendar counts',()=>{
  const rows=[node('a'),node('b',null,{sort_order:2048}),node('c','a',{event_date:'2026-01-02'})];
  const p=planJournalMove(rows,{id:'b',parent_id:null,book_id:'daily',expected_version:1,before_id:'a'});
  const next=rows.map(e=>p.after.find(a=>a.id===e.id)||e),index=journalIndex(next);
  assert.equal(index.children.get(null)[0].id,'b');
  assert.equal(next.filter(e=>matchesJournal(e,{date:'2026-01-01'})).length,2);
  assert.equal(next.filter(e=>matchesJournal(e,{date:'2026-01-02'})).length,1);
  assert.ok(next.every(e=>!('status' in e)));
});

test("journal event and input ordering differ without rewriting historical timestamps",()=>{
  const a=record({id:'a',event_date:'2026-01-01',event_time:null,created_at:'2026-01-04T00:00:00Z'}),b=record({id:'b',event_date:'2026-01-02',event_time:'12:00',created_at:'2026-01-03T00:00:00Z'});
  assert.deepEqual([b,a].sort((x,y)=>compareJournalTime(x,y,'event','asc')).map(x=>x.id),['a','b']);
  assert.deepEqual([a,b].sort((x,y)=>compareJournalTime(x,y,'created','asc')).map(x=>x.id),['b','a']);
  assert.deepEqual([a,b].sort((x,y)=>compareJournalTime(x,y,'created','desc')).map(x=>x.id),['a','b']);
});
test("journal expenses use cents and never double-count bill and dish",()=>{
  assert.equal(minorAmount('12.34'),1234);assert.equal(minorAmount(''),null);assert.equal(minorAmount('0'),0);assert.throws(()=>minorAmount('1.234'));
  const expense=(id,role,amount,personal,currency='CNY')=>record({expense:{id,bill_id:'meal',role,currency,amount_minor:amount,personal_minor:personal}});
  const sums=expenseTotals([expense('bill','bill',10000,5000),expense('dish','item',3000,null),expense('taxi','independent',2000,2000)]);
  assert.equal(sums.CNY.amount,12000);assert.equal(sums.CNY.personal,7000);
  assert.throws(()=>validateJournal(expense('bad','bill',-1,null)));
});
