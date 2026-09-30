import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ImagePlus,
  X,
  ChevronUp,
  ChevronDown,
  Star,
  Check,
  Plus,
} from "lucide-react";
import {
  JournalBook,
  JournalDraft,
  JournalEntry,
  journalHasContent,
  journalId,
  journalToday,
  validateJournal,
  minorAmount,
} from "../../services/journal/model";
import { journal } from "../../services/journal/store";
import { JournalImage } from "./JournalImage";
interface Props {
  draft: JournalDraft;
  books: JournalBook[];
  onClose: () => void;
  onSaved: (e: JournalEntry) => void;
  onBook: () => Promise<void>;
}
export function JournalEditor(p: Props) {
  const [draft, setDraft] = useState(p.draft),
    latest = useRef(draft);
  latest.current = draft;
  const [status, setStatus] = useState("尚未保存"),
    [error, setError] = useState(""),
    [publishing, setPublishing] = useState(false),
    [importing, setImporting] = useState(false),
    [progress, setProgress] = useState(""),
    [failures, setFailures] = useState<string[]>([]),
    [more, setMore] = useState(!!p.draft.entry.parent_id),
    [amountInput,setAmountInput] = useState(p.draft.entry.expense?.amount_minor == null ? '' : (p.draft.entry.expense.amount_minor/100).toFixed(2)),
    [personalInput,setPersonalInput] = useState(p.draft.entry.expense?.personal_minor == null ? '' : (p.draft.entry.expense.personal_minor/100).toFixed(2)),
    [bookName, setBookName] = useState(""),
    [confirmDiscard, setConfirmDiscard] = useState(false),
    [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(),
    saving = useRef(Promise.resolve()),
    alive = useRef(true),
    paused = useRef(false),
    dirty = useRef(false),
    operation = useRef<string | null>(null),
    busy = useRef(false),
    grid = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<JournalEntry>) => {
    dirty.current = true;
    operation.current = null;
    setStatus("尚未保存");
    setDraft((d) => ({ ...d, entry: { ...d.entry, ...patch } }));
  };
  const flush = async () => {
    clearTimeout(timer.current);
    if (paused.current || !dirty.current) return saving.current;
    const snapshot = structuredClone(latest.current);
    dirty.current = false;
    setStatus("保存草稿中…");
    const next = saving.current
      .catch(() => {})
      .then(async () => {
        try {
          await journal.mutate("saveDraft", { draft: snapshot });
          if (alive.current && !dirty.current) setStatus("草稿已保存");
        } catch (e) {
          dirty.current = true;
          if (alive.current) {
            setStatus("草稿保存失败");
            setError((e as Error).message);
          }
          throw e;
        }
      });
    saving.current = next;
    return next;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (dirty.current && !paused.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 800);
    }
    return () => clearTimeout(timer.current);
  }, [draft, importing]);
  const close = async () => {
    if (busy.current || importing) return;
    try {
      await flush();
      p.onClose();
    } catch {}
  };
  const handlers = useRef({ close, flush });
  handlers.current = { close, flush };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) void handlers.current.flush().catch(() => {});
    };
    const back = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      void handlers.current.close();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("todotree:back", back, true);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("todotree:back", back, true);
    };
  }, []);
  const pick = async (camera: boolean) => {
    if (busy.current || importing || draft.entry.images.length >= 20) return;
    setError("");
    setFailures([]);
    setImporting(true);
    setProgress("正在选择图片…");
    try {
      dirty.current = true;
      await flush();
      paused.current = true;
      const selected = await journal.pick(latest.current, camera, (p) =>
        setProgress(`正在保存照片 ${p.done + 1} / ${p.total}`),
      );
      const ids = selected.images?.map((i) => i.id) || [];
      if (ids.length) {
        dirty.current = true;
        const next = {
          ...latest.current,
          entry: {
            ...latest.current.entry,
            images: [...new Set([...latest.current.entry.images, ...ids])],
          },
        };
        latest.current = next;
        setDraft(next);
      }
      setFailures(selected.errors || []);
      setStatus(ids.length ? "照片已导入，正在保存草稿" : status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      paused.current = false;
      setImporting(false);
      try {
        await flush();
      } catch {}
    }
  };
  const priceChange = (value: string, personal=false) => {
    personal?setPersonalInput(value):setAmountInput(value);
    try {
      const current=latest.current.entry.expense || {id:journalId(),bill_id:latest.current.entry.id,role:latest.current.entry.parent_id?'independent' as const:'bill' as const,currency:'CNY' as const,amount_minor:null,personal_minor:null};
      update({expense:{...current,[personal?'personal_minor':'amount_minor']:minorAmount(value)}});
      setError('');
    }catch(e){setError((e as Error).message);}
  };
  const publish = async () => {
    if (busy.current || importing || failures.length) return;
    busy.current = true;
    setPublishing(true);
    setError("");
    try {
      minorAmount(amountInput);minorAmount(personalInput);
      validateJournal(latest.current.entry);
      await flush();
      paused.current = true;
      operation.current ??= journalId();
      const e = await journal.mutate(
        "publish",
        {
          entry: latest.current.entry,
          expected_version: latest.current.base_version,
          draft_id: latest.current.id,
        },
        operation.current,
      );
      dirty.current = false;
      p.onSaved(e);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      paused.current = false;
      busy.current = false;
      setPublishing(false);
    }
  };
  const reorder = (from: number, to: number) => {
    const images = [...latest.current.entry.images];
    if (to < 0 || to >= images.length || from === to) return;
    images.splice(to, 0, images.splice(from, 1)[0]);
    update({ images });
  };
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    let hold: ReturnType<typeof setTimeout> | undefined,
      index = -1,
      target = -1,
      active = false,
      x = 0,
      y = 0;
    const start = (e: TouchEvent) => {
      const tile = (e.target as Element).closest<HTMLElement>(
        "[data-photo-order]",
      );
      if (!tile || (e.target as Element).closest("button")) return;
      index = target = Number(tile.dataset.photoOrder);
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      hold = setTimeout(() => {
        active = true;
        setDragging(index);
        navigator.vibrate?.(10);
      }, 300);
    };
    const move = (e: TouchEvent) => {
      if (index < 0) return;
      const t = e.touches[0];
      if (!active) {
        if (Math.hypot(t.clientX - x, t.clientY - y) > 8) {
          clearTimeout(hold);
          index = -1;
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      const hit = document
        .elementFromPoint(t.clientX, t.clientY)
        ?.closest<HTMLElement>("[data-photo-order]");
      if (hit && el.contains(hit)) target = Number(hit.dataset.photoOrder);
    };
    const end = () => {
      clearTimeout(hold);
      if (active) reorderRef.current(index, target);
      active = false;
      index = -1;
      setDragging(null);
    };
    const cancel = () => {
      clearTimeout(hold);
      active = false;
      index = -1;
      setDragging(null);
    };
    el.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", cancel);
    return () => {
      clearTimeout(hold);
      el.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, []);
  const e = draft.entry;
  return (
    <section className="j-editor j-page" aria-label="编辑手帐">
      <header className="j-header">
        <button
          className="j-icon"
          aria-label="返回手帐并保留草稿"
          disabled={publishing || importing}
          onClick={() => void close()}
        >
          <ArrowLeft />
        </button>
        <div>
          <h1>{draft.base_version ? "编辑记录" : "记一笔"}</h1>
          <small role="status">{importing ? progress : status}</small>
        </div>
        <button
          className="j-primary"
          disabled={
            publishing ||
            importing ||
            !!failures.length ||
            !journalHasContent(e)
          }
          onClick={() => void publish()}
        >
          {publishing ? "保存中…" : "保存"}
        </button>
      </header>
      <div className="j-scroll j-editor-body">
        <label className="j-date-label">
          记录于{" "}
          <input
            aria-label="发生日期"
            type="date"
            max={journalToday(e.event_timezone)}
            value={e.event_date}
            disabled={publishing}
            onChange={(ev) => update({ event_date: ev.target.value })}
          />
          {e.event_date < journalToday(e.event_timezone) && <span>补记</span>}
        </label>
        {e.parent_id && <div className="j-muted">此条是事件细节，日期独立保存。
          {draft.base_version===0 && <button className="j-text" onClick={()=>update({parent_id:null})}>改为独立事件</button>}
        </div>}
        {error && (
          <div className="j-error" role="alert">
            {error}
            <button onClick={() => void flush().catch(() => {})}>
              重试保存草稿
            </button>
          </div>
        )}
        <fieldset disabled={publishing}>
          <input
            className="j-title-input"
            aria-label="手帐标题（选填）"
            placeholder="添加标题（选填）"
            maxLength={100}
            autoFocus={!!e.parent_id && !draft.base_version}
            value={e.title}
            onChange={(ev) => update({ title: ev.target.value })}
          />
          <textarea
            className="j-description"
            aria-label="事情描述"
            placeholder="发生了什么？先记一句也可以。"
            maxLength={20000}
            value={e.description}
            onChange={(ev) => update({ description: ev.target.value })}
            autoFocus={!e.parent_id}
          />
          <div className="j-photo-actions">
            <button
              disabled={importing || e.images.length >= 20}
              onClick={() => void pick(false)}
            >
              <ImagePlus size={20} />
              添加照片
            </button>
            <button
              disabled={importing || e.images.length >= 20}
              onClick={() => void pick(true)}
            >
              <Camera size={20} />
              拍照
            </button>
            <small>{e.images.length} / 20</small>
          </div>
          {failures.length > 0 && (
            <div className="j-error">
              {failures.map((m, i) => (
                <p key={i}>{m}</p>
              ))}
              <button onClick={() => setFailures([])}>
                忽略失败项，保留已导入图片
              </button>
              <button onClick={() => void pick(false)}>重新选择失败图片</button>
            </div>
          )}
          <div className="j-photo-grid" ref={grid}>
            {e.images.map((id, i) => (
              <div
                key={id}
                className={dragging === i ? "is-moving" : ""}
                data-photo-order={i}
              >
                <JournalImage id={id} />
                <button
                  className="j-photo-remove"
                  aria-label={`移除第 ${i + 1} 张照片`}
                  disabled={importing}
                  onClick={() =>
                    update({
                      images: e.images.filter((x) => x !== id),
                      cover_attachment_id:
                        e.cover_attachment_id === id
                          ? null
                          : e.cover_attachment_id,
                    })
                  }
                >
                  <X size={16} />
                </button>
                <div className="j-photo-tools">
                  <button
                    aria-label={`照片 ${i + 1} 前移`}
                    disabled={!i || importing}
                    onClick={() => reorder(i, i - 1)}
                  >
                    <ChevronUp size={17} />
                  </button>
                  <button
                    disabled={importing}
                    onClick={() => update({ cover_attachment_id: id })}
                  >
                    {(e.cover_attachment_id || e.images[0]) === id
                      ? "封面"
                      : "设封面"}
                  </button>
                  <button
                    aria-label={`照片 ${i + 1} 后移`}
                    disabled={i === e.images.length - 1 || importing}
                    onClick={() => reorder(i, i + 1)}
                  >
                    <ChevronDown size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {e.images.length > 1 && (
            <small className="j-muted">
              长按照片可调整顺序，也可用箭头移动。
            </small>
          )}
          <div className="j-tag-shortcuts" aria-label="常用事件标签">{['美食','旅行','购物','交通','日常'].map(tag=><button key={tag} aria-pressed={e.tags.includes(tag)} onClick={()=>update({tags:e.tags.includes(tag)?e.tags.filter(t=>t!==tag):[...e.tags,tag]})}>{tag}</button>)}</div>
          {(e.expense || e.tags.some(t=>/美食|购物|交通|住宿|消费/.test(t))) && <fieldset className="j-expense-box"><legend>这次消费 · 可留空</legend>
            <div className="j-money-fields"><label className="j-label">{e.expense?.role==='item'?'明细价格':'账单 / 消费金额'}<input aria-label="消费金额" inputMode="decimal" placeholder="金额（选填）" value={amountInput} onChange={ev=>priceChange(ev.target.value)}/></label>
            <label className="j-label">我实际支付<input aria-label="个人支付金额" inputMode="decimal" placeholder="选填" value={personalInput} onChange={ev=>priceChange(ev.target.value,true)}/></label></div>
            {e.expense && <div className="j-expense-options"><select aria-label="消费币种" value={e.expense.currency} onChange={ev=>update({expense:{...e.expense!,currency:ev.target.value as any}})}>{['CNY','USD','EUR','JPY','HKD'].map(v=><option key={v}>{v}</option>)}</select><select aria-label="消费统计口径" value={e.expense.role} onChange={ev=>update({expense:{...e.expense!,role:ev.target.value as any,bill_id:ev.target.value==='item'?e.expense!.bill_id:e.id}})}><option value="bill">账单总额</option><option value="item">账单中的明细</option><option value="independent">独立消费</option></select></div>}
            <small>未知金额留空，免费填 0。总账单与明细分别保存，同一账单不重复相加。</small>
          </fieldset>}
          {!e.expense&&!e.tags.some(t=>/美食|购物|交通|住宿|消费/.test(t)) && <button className="j-text" onClick={()=>update({expense:{id:journalId(),bill_id:e.id,role:'independent',currency:'CNY',amount_minor:null,personal_minor:null}})}>＋ 记录消费</button>}
          <label className="j-label">
            当时的感受
            <textarea
              aria-label="感受或评价"
              placeholder="喜欢什么？有什么想记住的？（选填）"
              maxLength={5000}
              value={e.reflection}
              onChange={(ev) => update({ reflection: ev.target.value })}
            />
          </label>
          <label className="j-label">
            收进哪本手帐
            <select
              aria-label="所属手帐本"
              disabled={draft.base_version>0 || !!e.parent_id}
              value={e.book_id}
              onChange={(ev) => update({ book_id: ev.target.value })}
            >
              {p.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>新建一本手帐</summary>
            <div className="j-inline">
              <input
                aria-label="新手帐本名称"
                disabled={draft.base_version>0 || !!e.parent_id}
                placeholder="例如：贵阳之旅"
                maxLength={60}
                value={bookName}
                onChange={(ev) => setBookName(ev.target.value)}
              />
              <button
                disabled={!bookName.trim()}
                onClick={async () => {
                  try {
                    const b = await journal.mutate("saveBook", {
                      book: {
                        id: journalId(),
                        name: bookName.trim(),
                        created_at: new Date().toISOString(),
                      },
                    });
                    await p.onBook();
                    if(draft.base_version===0&&!e.parent_id)update({ book_id: b.id });
                    setBookName("");
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <Plus size={18} />
                创建
              </button>
            </div>
          </details>
          <button className="j-text" onClick={() => setMore((v) => !v)}>
            {more ? "收起更多信息" : "＋ 地点、时间、评分、标签"}
          </button>
          {more && (
            <div className="j-extras">
              <label className="j-label">
                大致时间
                <input
                  type="time"
                  aria-label="发生时间"
                  value={e.event_time || ""}
                  onChange={(ev) =>
                    update({ event_time: ev.target.value || null })
                  }
                />
              </label>
              <label className="j-label">
                地点
                <input
                  aria-label="地点"
                  maxLength={200}
                  placeholder="店名、景点或城市（选填）"
                  value={e.location_text}
                  onChange={(ev) => update({ location_text: ev.target.value })}
                />
              </label>
              <label className="j-label">地点分享链接<input aria-label="地点分享链接" placeholder="粘贴高德 / 美团 / 口碑链接（选填）" value={e.place_url || ''} onChange={ev=>update({place_url:ev.target.value || null})}/></label>
              <div className="j-label">
                这次体验
                <div className="j-stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`${n} 星`}
                      aria-pressed={e.rating === n}
                      onClick={() =>
                        update({ rating: e.rating === n ? null : n })
                      }
                    >
                      <Star
                        fill={n <= (e.rating || 0) ? "currentColor" : "none"}
                        size={26}
                      />
                    </button>
                  ))}
                  {e.rating && (
                    <button onClick={() => update({ rating: null })}>
                      清除
                    </button>
                  )}
                </div>
              </div>
              <label className="j-label">
                标签
                <input
                  aria-label="标签"
                  placeholder="用逗号分隔，如：旅行，美食"
                  value={e.tags.join("，")}
                  onChange={(ev) =>
                    update({ tags: ev.target.value.split(/[,，]/) })
                  }
                  onBlur={() =>
                    update({
                      tags: [
                        ...new Set(e.tags.map((t) => t.trim()).filter(Boolean)),
                      ],
                    })
                  }
                />
              </label>
            </div>
          )}
        </fieldset>
        <p className="j-muted">
          原图会保存到此设备。未填的时间、地点和评分会保持空白。
        </p>
        <button
          className="j-danger"
          disabled={publishing || importing}
          onClick={() => setConfirmDiscard(true)}
        >
          丢弃本次草稿
        </button>
      </div>
      {confirmDiscard && (
        <div className="j-modal-backdrop">
          <section className="j-modal" role="alertdialog">
            <h2>丢弃本次草稿？</h2>
            <p>
              {draft.base_version
                ? "原来的正式记录会保留。"
                : "这份尚未发布的内容将被移除。"}
            </p>
            <button onClick={() => setConfirmDiscard(false)}>继续编辑</button>
            <button
              className="j-danger"
              onClick={async () => {
                clearTimeout(timer.current);
                paused.current = true;
                await saving.current.catch(() => {});
                try {
                  await journal.mutate("discardDraft", { id: draft.id });
                  dirty.current = false;
                  p.onClose();
                } catch (err) {
                  paused.current = false;
                  setError((err as Error).message);
                  setConfirmDiscard(false);
                }
              }}
            >
              确认丢弃
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
