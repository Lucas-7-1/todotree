import {
  Capacitor,
  registerPlugin,
  PluginListenerHandle,
} from "@capacitor/core";
import {
  JournalDraft,
  JournalEntry,
  JournalBook,
  JournalCursor,
  JournalFilter,
  JournalMonth,
  journalId,
} from "./model";
const native = Capacitor.getPlatform() === "android";
interface NativeJournal {
  command(o: Record<string, unknown>): Promise<any>;
  media(o: {
    id: string;
  }): Promise<{ original: string; preview: string; thumbnail: string }>;
  pickImages(o: {
    camera: boolean;
    limit: number;
    draft_id: string;
  }): Promise<{
    cancelled?: boolean;
    images?: { id: string }[];
    errors?: string[];
  }>;
  exportBackup(): Promise<{ cancelled?: boolean }>;
  importBackup(): Promise<{
    cancelled?: boolean;
    added?: number;
    conflicts?: number;
  }>;
  openOriginal(o: { id: string }): Promise<void>;
  addListener(
    name: "importProgress",
    cb: (p: { done: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}
const bridge = registerPlugin<NativeJournal>("Journal");
const command = (action: string, data: Record<string, unknown> = {}) =>
  native
    ? bridge.command({ action, ...data })
    : import("./web").then((m) => m.journalWeb({ action, ...data }));
export const journal = {
  native,
  boot: (): Promise<{ books: JournalBook[]; drafts: JournalDraft[] }> =>
    command("boot"),
  get: (id: string): Promise<JournalEntry> => command("get", { id }),
  month: (f: JournalFilter): Promise<JournalMonth> =>
    command("month", f as Record<string, unknown>),
  list: (
    f: JournalFilter,
    cursor: JournalCursor | null = null,
  ): Promise<{ entries: JournalEntry[]; cursor: JournalCursor | null }> =>
    command("list", { ...f, cursor, limit: 20 }),
  mutate: (
    action: string,
    data: Record<string, unknown>,
    operation_id = journalId(),
  ) => command(action, { ...data, operation_id }),
  media: async (id: string) => {
    if (!native) return (await import("./web")).webMedia(id);
    const result = await bridge.media({ id });
    return {
      original: Capacitor.convertFileSrc(result.original),
      preview: Capacitor.convertFileSrc(result.preview),
      thumbnail: Capacitor.convertFileSrc(result.thumbnail),
    };
  },
  pick: async (
    draft: JournalDraft,
    camera: boolean,
    progress: (p: { done: number; total: number }) => void,
  ) => {
    if (native) {
      const listener = await bridge.addListener("importProgress", progress);
      try {
        return await bridge.pickImages({
          camera,
          limit: 20 - draft.entry.images.length,
          draft_id: draft.id,
        });
      } finally {
        await listener.remove();
      }
    }
    return new Promise<{
      cancelled?: boolean;
      images?: { id: string }[];
      errors?: string[];
    }>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.multiple = !camera;
      if (camera) input.capture = "environment";
      input.oncancel = () => resolve({ cancelled: true });
      input.onchange = async () => {
        const files = [...(input.files || [])];
        const images: { id: string }[] = [],
          errors: string[] = [];
        const room = 20 - draft.entry.images.length;
        for (const [i, file] of files.slice(0, room).entries()) {
          progress({ done: i, total: Math.min(room, files.length) });
          try {
            images.push(await (await import("./web")).importWebImage(file));
          } catch (e) {
            errors.push(`${file.name}：${(e as Error).message}`);
          }
        }
        if (files.length > room) errors.push("超出 20 张的图片未导入");
        resolve({ images, errors });
      };
      input.click();
    });
  },
  export: () =>
    native
      ? bridge.exportBackup()
      : Promise.reject(Error("包含原图的手帐备份请在 Android 应用中使用")),
  import: () =>
    native
      ? bridge.importBackup()
      : Promise.reject(Error("手帐备份恢复请在 Android 应用中使用")),
  original: async (id: string) => {
    if (native) return bridge.openOriginal({ id });
    const m = await journal.media(id);
    window.open(m.original, "_blank");
  },
  stats: (): Promise<{ original_bytes: number; available_bytes?: number }> =>
    command("stats"),
};
