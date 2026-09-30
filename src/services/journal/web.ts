import { journalIndex, normalizeJournal, planJournalMove } from "./tree";
import {
  JournalEntry,
  validateJournal,
  matchesJournal,
  compareJournal,
  compareJournalTime,
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
    const r = indexedDB.open("todotree-journal-v1", 2);
    r.onupgradeneeded = () => {
      for (const name of ["entries", "drafts", "books", "images", "operations"])
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath: "id" });
      const entries = r.transaction!.objectStore('entries');
      if (!entries.indexNames.contains('parent_id')) entries.createIndex('parent_id', 'parent_id');
      const cursor = entries.openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if(c) { c.update(normalizeJournal(c.value)); c.continue(); } };
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
      const ix = journalIndex(await request(table('entries').getAll()));
      result = {...result, child_count:ix.summary(result).child_count, other_date_count:ix.summary(result).other_date_count, path:ix.summary(result).path};
    } else if (o.action === 'children' || o.action === 'branch') {
      const ix = journalIndex(await request(table('entries').getAll()));
      if (o.action === 'branch') result = {count:ix.descendants(o.id).filter(e=>!e.deleted_at).length};
      else { const rows=(ix.children.get(o.parent_id || null)||[]).filter(e=>!e.deleted_at && (!o.book_id || e.book_id===o.book_id)).sort((a,b)=>compareJournalTime(a,b,o.sort||'event',o.direction||'asc'));
        result={entries:rows.slice(o.offset || 0,(o.offset || 0)+20).map(ix.summary),total:rows.length}; }
    } else if (o.action === "list" || o.action === "month") {
      const allEntries = (await request(table("entries").getAll())) as JournalEntry[];
      const ix = journalIndex(allEntries);
      const entries = allEntries
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
            ...ix.summary(normalizeJournal(e)),
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
      const e = normalizeJournal(o.entry as JournalEntry);
      delete e.child_count; delete e.path; delete e.other_date_count;
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
      const all = (await request(table('entries').getAll())) as JournalEntry[];
      if (old && (old.parent_id !== e.parent_id || old.book_id !== e.book_id)) throw Error('请通过移动到调整所属事件或手帐本');
      if (!old) { const peers=all.filter(p=>(p.parent_id||null)===e.parent_id && p.book_id===e.book_id); result.sort_order=Math.max(0,...peers.map(p=>p.sort_order||0))+1024; }
      journalIndex([...all.filter(p=>p.id!==e.id),result]).validate();
      result.cover_attachment_id=result.images.includes(result.cover_attachment_id) ? result.cover_attachment_id : result.images[0] || null;
      table("entries").put(result);
      table("drafts").delete(o.draft_id);
    } else if (['move','undo','setCover','delete','restore','purge'].includes(o.action)) {
      const all=(await request(table('entries').getAll())) as JournalEntry[], ix=journalIndex(all);
      const e=ix.byId.get(o.id);
      let before:JournalEntry[]=[], after:JournalEntry[]=[];
      const bump=(item:JournalEntry, patch:Partial<JournalEntry>)=>({...item,...patch,version:item.version+1,updated_at:new Date().toISOString()});
      if(o.action==='undo') {
        const operation=await request(table('operations').get(o.undo_id));
        if(!operation?.before || operation.undone) throw Error('操作已撤销或不可撤销');
        for(const old of operation.before as JournalEntry[]) {
          const current=ix.byId.get(old.id), written=operation.after.find((p:JournalEntry)=>p.id===old.id);
          if(!current || current.version!==written.version) throw Error('相关记录已修改，请刷新后使用移动或恢复');
          before.push(current); after.push({...old,version:current.version+1,updated_at:new Date().toISOString()});
        }
        journalIndex(all.map(p=>after.find(a=>a.id===p.id)||p)).validate();
        table('operations').put({...operation,undone:true});
      } else {
        if(!e) throw Error('记录不存在');
        if(o.action!=='purge' && e.version!==o.expected_version) throw Error('记录已变化，请刷新');
        if(o.action==='move') {
          if(!(await request(table('books').get(o.book_id)))) throw Error('目标手帐不存在');
          ({before,after}=planJournalMove(all,o));
        } else if(o.action==='setCover') {
          if(e.deleted_at || !e.images.includes(o.attachment_id)) throw Error('封面必须来自当前事件的照片');
          before=[e]; after=[bump(e,{cover_attachment_id:o.attachment_id})];
        } else if(o.action==='delete') {
          if(e.deleted_at) throw Error('事件已经在回收站');
          before=[e,...ix.descendants(e.id).filter(p=>!p.deleted_at)];
          if(before.length>1 && o.expected_count!==before.length-1) throw Error('细节数量已变化，请重新确认删除');
          after=before.map(p=>bump(p,{deleted_at:new Date().toISOString(),deletion_batch_id:o.operation_id}));
        } else if(o.action==='restore') {
          if(!e.deleted_at) throw Error('事件已恢复');
          before=[e,...ix.descendants(e.id).filter(p=>p.deleted_at && e.deletion_batch_id && p.deletion_batch_id===e.deletion_batch_id)];
          const parent=e.parent_id ? ix.byId.get(e.parent_id) : null;
          const root=!parent || parent.deleted_at;
          const bookExists=await request(table('books').get(e.book_id));
          after=before.map(p=>bump(p,{deleted_at:null,deletion_batch_id:null,book_id:bookExists?e.book_id:'daily',parent_id:p.id===e.id&&root?null:p.parent_id}));
          result={restored_as_root:!!e.parent_id&&root};
          journalIndex(all.map(p=>after.find(a=>a.id===p.id)||p)).validate();
        } else {
          if(!e.deleted_at) throw Error('仅回收站记录可永久删除');
          const affected=[e,...ix.descendants(e.id)];
          if(affected.some(p=>!p.deleted_at)) throw Error('请先处理尚未删除的细节');
          for(const p of affected) table('entries').delete(p.id);
        }
      }
      for(const p of after) table('entries').put(p);
      result={...result,...(after.find(p=>p.id===o.id)||{}),count:after.length,operation_id:o.operation_id};
      if(before.length) table('operations').put({id:o.operation_id,result,before,after});
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
      for (const d of await request(table("drafts").getAll())) {
        if (d.entry.book_id !== o.id) continue;
        d.entry.book_id = "daily";
        const current = await request(table("entries").get(d.entry.id));
        if (current && d.base_version === current.version - 1)
          d.base_version = current.version;
        table("drafts").put(d);
      }
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
    if (o.operation_id && !["saveDraft", "discardDraft", "move", "undo", "setCover", "delete", "restore", "purge"].includes(o.action))
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
