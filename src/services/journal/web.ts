import {
  JournalEntry,
  validateJournal,
  matchesJournal,
  compareJournal,
  journalId,
} from "./model";
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
let opened: Promise<IDBDatabase> | undefined;
function open() {
  return (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("todotree-journal-v1", 1);
    r.onupgradeneeded = () => {
      for (const name of ["entries", "drafts", "books", "images", "operations"])
        r.result.createObjectStore(name, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function journalWeb(o: any): Promise<any> {
  const db = await open(),
    tx = db.transaction(
      ["entries", "drafts", "books", "images", "operations"],
      "readwrite",
    );
  const done = new Promise<void>((r, j) => {
    tx.oncomplete = () => r();
    tx.onabort = () => j(tx.error || Error("手帐保存失败"));
    tx.onerror = () => {};
  });
  done.catch(() => {});
  const table = (name: string) => tx.objectStore(name);
  let result: any = {};
  try {
    if (!(await request(table("books").get("daily"))))
      table("books").put({
        id: "daily",
        name: "日常",
        created_at: new Date().toISOString(),
      });
    const oldOp =
      o.operation_id &&
      (await request(table("operations").get(o.operation_id)));
    if (oldOp) {
      await done;
      return oldOp.result;
    }
    if (o.action === "boot")
      result = {
        books: await request(table("books").getAll()),
        drafts: await request(table("drafts").getAll()),
      };
    else if (o.action === "get") {
      result = await request(table("entries").get(o.id));
      if (!result) throw Error("记录不存在");
    } else if (o.action === "list" || o.action === "month") {
      const entries = (
        (await request(table("entries").getAll())) as JournalEntry[]
      )
        .filter((e) => matchesJournal(e, o))
        .sort(compareJournal);
      if (o.action === "month") {
        const counts = new Map<string, number>();
        entries.forEach((e) =>
          counts.set(e.event_date, (counts.get(e.event_date) || 0) + 1),
        );
        result = {
          days: [...counts].map(([date, count]) => ({ date, count })),
          count: entries.length,
          image_count: entries.reduce((n, e) => n + e.images.length, 0),
        };
      } else {
        const candidates = o.cursor
          ? entries.filter(
              (e) =>
                compareJournal(e, {
                  event_date: o.cursor.date,
                  event_time: o.cursor.time,
                  created_at: o.cursor.created,
                  id: o.cursor.id,
                } as JournalEntry) > 0,
            )
          : entries;
        const limit = o.limit || 20,
          rows = candidates.slice(0, limit),
          last = rows[rows.length - 1];
        result = {
          entries: rows.map((e) => ({
            ...e,
            description: e.description.slice(0, 180),
            reflection: e.reflection.slice(0, 180),
          })),
          cursor:
            candidates.length > limit && last
              ? {
                  date: last.event_date,
                  time: last.event_time || "99:99",
                  created: last.created_at,
                  id: last.id,
                }
              : null,
        };
      }
    } else if (o.action === "saveDraft") {
      validateJournal(o.draft.entry, false);
      result = { ...o.draft, updated_at: new Date().toISOString() };
      for (const id of result.entry.images)
        if (!(await request(table("images").get(id))))
          throw Error("图片未保存");
      table("drafts").put(result);
    } else if (o.action === "discardDraft") table("drafts").delete(o.id);
    else if (o.action === "publish") {
      const e = o.entry as JournalEntry;
      validateJournal(e);
      const old = await request(table("entries").get(e.id));
      if ((old?.version || 0) !== o.expected_version || old?.deleted_at)
        throw Error("记录已变化，请重新打开核对");
      for (const id of e.images)
        if (!(await request(table("images").get(id))))
          throw Error("图片未保存");
      result = {
        ...e,
        version: o.expected_version + 1,
        created_at: old?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };
      table("entries").put(result);
      table("drafts").delete(o.draft_id);
    } else if (
      o.action === "delete" ||
      o.action === "restore" ||
      o.action === "purge"
    ) {
      const e = await request(table("entries").get(o.id));
      if (!e) throw Error("记录不存在");
      if (o.action === "purge") {
        if (!e.deleted_at) throw Error("仅回收站记录可永久删除");
        table("entries").delete(o.id);
      } else {
        if (e.version !== o.expected_version) throw Error("记录已变化，请刷新");
        result = {
          ...e,
          version: e.version + 1,
          deleted_at: o.action === "delete" ? new Date().toISOString() : null,
        };
        table("entries").put(result);
      }
    } else if (o.action === "saveBook") {
      if (!o.book.name.trim() || o.book.name.length > 60)
        throw Error("名称应为 1–60 字");
      result = o.book;
      table("books").put(result);
    } else if (o.action === "deleteBook") {
      if (o.id === "daily") throw Error("日常手帐不可删除");
      for (const e of await request(table("entries").getAll()))
        if (e.book_id === o.id)
          table("entries").put({
            ...e,
            book_id: "daily",
            version: e.version + 1,
          });
      table("books").delete(o.id);
    } else if (o.action === "stats") {
      const images = await request(table("images").getAll());
      result = {
        original_bytes: images.reduce(
          (n: number, e: any) => n + e.blob.size,
          0,
        ),
      };
    } else throw Error("未支持的手帐操作");
    if (o.operation_id && !["saveDraft", "discardDraft"].includes(o.action))
      table("operations").put({ id: o.operation_id, result });
    await done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    throw e;
  }
}
export async function importWebImage(file: File) {
  if (file.size > 25 * 1024 * 1024) throw Error("单张图片最大 25 MiB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("请选择 JPG、PNG 或 WebP 图片");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 100000000) {
    bitmap.close();
    throw Error("图片分辨率过大");
  }
  const canvas = document.createElement("canvas"),
    ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = await new Promise<Blob>((r) =>
    canvas.toBlob((b) => r(b!), "image/jpeg", 0.88),
  );
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const id = [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const db = await open();
  const tx = db.transaction("images", "readwrite");
  const done = new Promise<void>((r, j) => {
    tx.oncomplete = () => r();
    tx.onabort = () => j(tx.error);
  });
  tx.objectStore("images").put({ id, blob: file, preview });
  await done;
  return { id };
}
const urls = new Map<
  string,
  { original: string; preview: string; thumbnail: string }
>();
export async function webMedia(id: string) {
  if (urls.has(id)) return urls.get(id)!;
  const db = await open();
  const image = await request(
    db.transaction("images").objectStore("images").get(id),
  );
  if (!image) throw Error("图片缺失");
  const original = URL.createObjectURL(image.blob),
    preview = URL.createObjectURL(image.preview);
  const result = { original, preview, thumbnail: preview };
  urls.set(id, result);
  if (urls.size > 60) {
    const key = urls.keys().next().value!;
    const old = urls.get(key)!;
    URL.revokeObjectURL(old.original);
    URL.revokeObjectURL(old.preview);
    urls.delete(key);
  }
  return result;
}
