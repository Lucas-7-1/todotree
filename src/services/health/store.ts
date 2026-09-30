import { PluginListenerHandle, registerPlugin } from "@capacitor/core";
import { isAndroid } from "../native/platform";
import {
  HealthClock,
  HealthEntity,
  HealthSnapshot,
  emptyHealth,
  healthDay,
  healthId,
  validateHealthRecord,
  validateHealthSnapshot,
} from "./model";

interface HealthAck {
  revision: number;
  saved_at: string;
  operation_id: string;
  reminder_error?: string;
}
interface NativeHealth {
  read(): Promise<HealthSnapshot>;
  takeLaunchSession(): Promise<{ session_id: string | null }>;
  addListener(
    name: "openSession",
    handler: (e: { session_id: string }) => void,
  ): Promise<PluginListenerHandle>;
  commit(o: {
    expected_revision: number;
    operation_id: string;
    changes: HealthEntity[];
  }): Promise<HealthAck>;
  clock(): Promise<HealthClock>;
  notificationStatus(): Promise<{ granted: boolean; exact: boolean }>;
  requestNotifications(): Promise<{ granted: boolean; exact: boolean }>;
  exactSettings(): Promise<void>;
  openTimer(o: { seconds: number }): Promise<void>;
}
export const HealthNative = registerPlugin<NativeHealth>("Health");
let reminderError = "";
export const healthReminderError = () => reminderError;
let cached: HealthSnapshot | null = null,
  loading: Promise<HealthSnapshot> | null = null,
  tail: Promise<unknown> = Promise.resolve();
let pending: {
  expected_revision: number;
  operation_id: string;
  changes: HealthEntity[];
} | null = null;
const listeners = new Set<() => void>();
let dbPromise: Promise<IDBDatabase> | null = null;
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || Error("健康记录保存失败，输入已保留"));
    tx.onerror = () => {};
  });
function db() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("todotree-health-v1", 1);
    r.onupgradeneeded = () => {
      const entries = r.result.createObjectStore("records", { keyPath: "id" });
      entries.createIndex("kind_day", ["kind", "day"]);
      r.result.createObjectStore("meta");
      r.result.createObjectStore("operations", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      dbPromise = null;
      reject(r.error);
    };
    r.onblocked = () => reject(Error("健康数据库被占用，请关闭另一窗口后重试"));
  }));
}
async function browserRead(): Promise<HealthSnapshot> {
  const database = await db(),
    tx = database.transaction(["records", "meta"]),
    finish = done(tx);
  finish.catch(() => {});
  const [records, meta] = await Promise.all([
    req(tx.objectStore("records").getAll()),
    req(tx.objectStore("meta").get("state")),
  ]);
  await finish;
  return { ...emptyHealth(), ...meta, records };
}
async function browserCommit(
  op: NonNullable<typeof pending>,
): Promise<HealthAck> {
  const database = await db(),
    tx = database.transaction(["records", "meta", "operations"], "readwrite"),
    finish = done(tx);
  finish.catch(() => {});
  try {
    const existing = await req(
      tx.objectStore("operations").get(op.operation_id),
    );
    if (existing) {
      await finish;
      return existing.ack;
    }
    const meta =
      (await req(tx.objectStore("meta").get("state"))) || emptyHealth();
    if (meta.revision !== op.expected_revision)
      throw Error("健康数据已在其他窗口修改，请重新打开核对");
    for (const e of op.changes) {
      const old = await req(tx.objectStore("records").get(e.id));
      if (e.version !== (old?.version || 0) + 1)
        throw Error("健康记录版本冲突");
      tx.objectStore("records").put(e);
    }
    const ack = {
      revision: meta.revision + 1,
      saved_at: new Date().toISOString(),
      operation_id: op.operation_id,
    };
    tx.objectStore("meta").put({ schema_version: 1, ...ack }, "state");
    tx.objectStore("operations").put({ id: op.operation_id, ack });
    await finish;
    return ack;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    throw e;
  }
}
export function readHealth() {
  if (cached) return Promise.resolve(cached);
  if (!loading)
    loading = (isAndroid() ? HealthNative.read() : browserRead())
      .then((s) => {
        validateHealthSnapshot(s);
        cached = s;
        return s;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  return loading;
}
export const peekHealth = () => cached;
export const hasPendingHealthSave = () => !!pending;
export function subscribeHealth(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
async function send(op: NonNullable<typeof pending>) {
  const ack = await (isAndroid() ? HealthNative.commit(op) : browserCommit(op));
  reminderError = ack.reminder_error || "";
  if (
    ack.operation_id !== op.operation_id ||
    ack.revision !== op.expected_revision + 1
  )
    throw Error("健康保存确认不匹配，保留待恢复操作");
  const changes = new Map(op.changes.map((e) => [e.id, e]));
  const records = cached!.records.map((e) => {
    const newer = changes.get(e.id);
    changes.delete(e.id);
    return newer || e;
  });
  records.push(...changes.values());
  cached = { schema_version: 1, ...ack, records };
  listeners.forEach((fn) => fn());
  return cached;
}
/** Changes are incremental and serialized. Counter/timer display frames never write here. */
export function commitHealth(
  change: (s: HealthSnapshot) => HealthEntity[],
  historicalImport = false,
) {
  const job = tail.then(async () => {
    const s = await readHealth();
    if (pending) throw Error("上次健康保存未确认，请先重试保存");
    const list = change(s);
    if (!list.length) return s;
    const byId = new Map(s.records.map((e) => [e.id, e])),
      ids = new Set<string>(),
      now = new Date().toISOString();
    const changes = list.map((e) => {
      if (ids.has(e.id)) throw Error("重复记录变更");
      ids.add(e.id);
      const old = byId.get(e.id);
      if (
        !old &&
        !historicalImport &&
        ["weight", "sleep", "intake"].includes(e.kind) &&
        e.day > healthDay()
      )
        throw Error("实际记录不能保存在未来日期");
      if (old && e.version !== old.version)
        throw Error("记录已修改，请重新打开");
      const n = {
        ...e,
        body: structuredClone(e.body),
        created_at: old?.created_at || e.created_at,
        updated_at: now,
        version: (old?.version || 0) + 1,
      };
      validateHealthRecord(n);
      return n;
    });
    const op = {
      expected_revision: s.revision,
      operation_id: healthId(),
      changes,
    };
    try {
      return await send(op);
    } catch (e) {
      pending = op;
      throw e;
    }
  });
  tail = job.catch(() => {});
  return job;
}
export function retryHealthSave() {
  const job = tail.then(async () => {
    await readHealth();
    if (!pending) return cached!;
    const s = await send(pending);
    pending = null;
    return s;
  });
  tail = job.catch(() => {});
  return job;
}
export async function exportHealth() {
  await tail;
  if (pending) throw Error("有未确认保存，请重试后再备份");
  const s = await readHealth();
  return JSON.stringify(
    {
      format: "todotree-health",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      records: s.records,
    },
    null,
    2,
  );
}
export async function importHealth(value: any) {
  if (value?.format !== "todotree-health" || value.schema_version !== 1)
    throw Error("不是健康备份文件");
  validateHealthSnapshot({ ...emptyHealth(), records: value.records });
  let added = 0,
    conflicts = 0;
  await commitHealth((s) => {
    const byId = new Map(s.records.map((e) => [e.id, e]));
    return value.records
      .filter((e: HealthEntity) => {
        const old = byId.get(e.id);
        if (old) {
          if (JSON.stringify(old) !== JSON.stringify(e)) conflicts++;
          return false;
        }
        added++;
        return true;
      })
      .map((e: HealthEntity) => ({ ...e, version: 0 }));
  }, true);
  return { added, conflicts };
}
let clockBase: HealthClock = {
  wall: Date.now(),
  mono: performance.now(),
  boot: "web-" + performance.timeOrigin,
};
let syncedAt = performance.now();
export async function syncHealthClock() {
  clockBase = isAndroid()
    ? await HealthNative.clock()
    : {
        wall: Date.now(),
        mono: performance.now(),
        boot: "web-" + performance.timeOrigin,
      };
  syncedAt = performance.now();
  return nowClock();
}
export function nowClock(): HealthClock {
  const elapsed = performance.now() - syncedAt;
  return {
    wall: clockBase.wall + elapsed,
    mono: clockBase.mono + elapsed,
    boot: clockBase.boot,
  };
}

if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (event) => {
    if (pending) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
