export interface JournalEntry {
  id: string;
  book_id: string;
  event_date: string;
  event_time: string | null;
  event_timezone: string;
  title: string;
  description: string;
  reflection: string;
  rating: number | null;
  location_text: string;
  tags: string[];
  images: string[];
  cover_attachment_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}
export interface JournalBook {
  id: string;
  name: string;
  created_at: string;
  cover_attachment_id?: string | null;
}
export interface JournalDraft {
  id: string;
  entry: JournalEntry;
  base_version: number;
  updated_at: string;
}
export interface JournalCursor {
  date: string;
  time: string;
  created: string;
  id: string;
}
export interface JournalFilter {
  date?: string;
  from?: string;
  to?: string;
  book_id?: string;
  query?: string;
  trash?: boolean;
  has_images?: boolean;
  min_rating?: number;
  max_rating?: number;
}
export interface JournalMonth {
  days: { date: string; count: number }[];
  count: number;
  image_count: number;
}
export const journalId = (): string => crypto.randomUUID();
export function journalToday(
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function newJournal(date: string, book = "daily"): JournalDraft {
  const now = new Date().toISOString();
  return {
    id: journalId(),
    base_version: 0,
    updated_at: now,
    entry: {
      id: journalId(),
      book_id: book,
      event_date: date,
      event_time: null,
      event_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      title: "",
      description: "",
      reflection: "",
      rating: null,
      location_text: "",
      tags: [],
      images: [],
      cover_attachment_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      version: 0,
    },
  };
}
export function journalHasContent(e: JournalEntry) {
  return !!(
    e.title.trim() ||
    e.description.trim() ||
    e.reflection.trim() ||
    e.rating !== null ||
    e.images.length
  );
}
export function validateJournal(e: JournalEntry, publish = true) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(e.event_date) ||
    !Number.isFinite(Date.parse(e.event_date + "T12:00:00Z")) ||
    new Date(e.event_date + "T12:00:00Z").toISOString().slice(0, 10) !==
      e.event_date
  )
    throw Error("日期无效");
  if (e.event_date > journalToday(e.event_timezone))
    throw Error("手帐记录今天及过去发生的事情");
  if (e.event_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.event_time))
    throw Error("时间无效");
  if (
    e.title.length > 100 ||
    e.description.length > 20000 ||
    e.reflection.length > 5000 ||
    e.location_text.length > 200
  )
    throw Error("内容超过字数上限");
  if (
    e.rating !== null &&
    (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5)
  )
    throw Error("评分应为 1–5 星，也可留空");
  if (e.images.length > 20 || new Set(e.images).size !== e.images.length)
    throw Error("最多 20 张图片，请去除重复项");
  if (e.tags.length > 10 || e.tags.some((t) => t.length > 20))
    throw Error("最多 10 个标签，每个 20 字");
  if (publish && !journalHasContent(e)) throw Error("写点内容或添加照片再保存");
}
export function journalTitle(e: JournalEntry) {
  return (
    e.title.trim() ||
    e.description.trim().split("\n")[0] ||
    e.reflection.trim().split("\n")[0] ||
    (e.images.length ? "照片记录" : "一次体验")
  );
}
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    from: month + "-01",
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
}
export function monthGrid(month: string) {
  const first = new Date(month + "-01T12:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Number(monthRange(month).to.slice(-2));
  return Array.from({ length: Math.ceil((days + offset) / 7) * 7 }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(1 - offset + i);
    return d.toISOString().slice(0, 10);
  });
}
export function shiftMonth(month: string, by: number) {
  const d = new Date(month + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}
export function matchesJournal(e: JournalEntry, f: JournalFilter) {
  return (
    Boolean(e.deleted_at) === Boolean(f.trash) &&
    (!f.book_id || e.book_id === f.book_id) &&
    (!f.date || e.event_date === f.date) &&
    (!f.from || e.event_date >= f.from) &&
    (!f.to || e.event_date <= f.to) &&
    (!f.query ||
      [e.title, e.description, e.reflection, e.location_text, ...e.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(f.query.trim().toLocaleLowerCase())) &&
    (f.has_images === undefined || Boolean(e.images.length) === f.has_images) &&
    (!f.min_rating || (e.rating !== null && e.rating >= f.min_rating)) &&
    (!f.max_rating || (e.rating !== null && e.rating <= f.max_rating))
  );
}
export function compareJournal(a: JournalEntry, b: JournalEntry) {
  return (
    b.event_date.localeCompare(a.event_date) ||
    (a.event_time || "99:99").localeCompare(b.event_time || "99:99") ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}
