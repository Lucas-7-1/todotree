import {
  HealthEntity,
  HealthSnapshot,
  entity,
  plannedOccurrence,
  planDates,
} from "./model";
import { commitHealth, readHealth } from "./store";
export async function ensureHealthDay(day: string, linkToday = false) {
  return commitHealth((s) => {
    const changes: HealthEntity[] = [],
      ids = new Set(s.records.map((r) => r.id));
    for (const plan of s.records.filter(
      (r) => r.kind === "plan" && !r.deleted_at,
    )) {
      if (!planDates(plan, day, day).length) continue;
      const occ = plannedOccurrence(plan, day);
      if (!ids.has(occ.id)) changes.push(occ);
      const existing = s.records.find((r) => r.id === occ.id);
      if (
        linkToday &&
        !ids.has("link-" + occ.id) &&
        !existing?.deleted_at &&
        (!existing || existing.body.state === "planned") &&
        !existing?.body.task_id
      )
        changes.push(
          entity(
            "outbox",
            {
              type: "create",
              occurrence_id: occ.id,
              status: "pending",
              attempts: 0,
            },
            day,
            "link-" + occ.id,
          ),
        );
    }
    return changes;
  });
}
export async function queueWorkoutTask(occ: HealthEntity) {
  return commitHealth((s) => {
    const old = s.records.find((e) => e.id === occ.id) || occ;
    const id = "link-" + occ.id,
      op = s.records.find((r) => r.id === id);
    return [
      ...(!s.records.some((r) => r.id === occ.id) ? [occ] : []),
      {
        ...(op || entity("outbox", {}, occ.day, id)),
        body: {
          type: "create",
          occurrence_id: old.id,
          status: "pending",
          attempts: 0,
        },
      },
    ];
  });
}
let sync: Promise<void> | null = null;
export function syncWorkoutOutbox(
  handler: (
    occ: HealthEntity,
    type: "create" | "complete",
  ) => Promise<string | null>,
  manual = false,
) {
  if (sync) return sync;
  sync = (async () => {
    const state = await readHealth();
    const pending = state.records.filter(
      (r) =>
        r.kind === "outbox" &&
        !r.deleted_at &&
        r.body.status === "pending" &&
        (manual || r.body.attempts < 3),
    );
    for (const op of pending) {
      const current = await readHealth(),
        occ = current.records.find(
          (r) => r.id === op.body.occurrence_id && !r.deleted_at,
        );
      if (!occ) continue;
      try {
        const taskId = await handler(occ, op.body.type);
        if (!taskId) throw Error("待办暂时无法保存");
        await commitHealth((s) => {
          const live = s.records.find((r) => r.id === op.id)!,
            o = s.records.find((r) => r.id === occ.id)!;
          return [
            { ...live, body: { ...live.body, status: "done", error: null } },
            ...(op.body.type === "create"
              ? [{ ...o, body: { ...o.body, task_id: taskId } }]
              : []),
          ];
        });
      } catch (error) {
        await commitHealth((s) => {
          const live = s.records.find((r) => r.id === op.id);
          return live
            ? [
                {
                  ...live,
                  body: {
                    ...live.body,
                    attempts: live.body.attempts + 1,
                    error: (error as Error).message,
                  },
                },
              ]
            : [];
        });
      }
    }
  })().finally(() => {
    sync = null;
  });
  return sync;
}
