import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  X,
  MapPin,
  Trash2,
  Download,
  Upload,
  NotebookPen,
} from "lucide-react";
import { journal } from "../../services/journal/store";
import {
  JournalBook,
  JournalCursor,
  JournalDraft,
  JournalEntry,
  JournalFilter,
  JournalMonth,
  journalId,
  journalTitle,
  journalToday,
  monthGrid,
  monthRange,
  newJournal,
  shiftMonth,
} from "../../services/journal/model";
import { JournalEditor } from "./JournalEditor";
import { JournalImage, JournalViewer } from "./JournalImage";
import "./journal.css";
export default function JournalApp({
  onClose,
  create = false,
}: {
  onClose: () => void;
  create?: boolean;
}) {
  const today = journalToday(),
    [selected, setSelected] = useState(today),
    [month, setMonth] = useState(today.slice(0, 7)),
    [week, setWeek] = useState(false),
    [mode, setMode] = useState<"calendar" | "timeline">("calendar");
  const [books, setBooks] = useState<JournalBook[]>([]),
    [drafts, setDrafts] = useState<JournalDraft[]>([]),
    [book, setBook] = useState(""),
    [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [photos, setPhotos] = useState("all"),
    [rating, setRating] = useState(""),
    [maxRating, setMaxRating] = useState("");
  const [entries, setEntries] = useState<JournalEntry[]>([]),
    [summary, setSummary] = useState<JournalMonth>({
      days: [],
      count: 0,
      image_count: 0,
    }),
    [cursor, setCursor] = useState<JournalCursor | null>(null),
    [pages, setPages] = useState<(JournalCursor | null)[]>([]),
    [currentCursor, setCurrentCursor] = useState<JournalCursor | null>(null);
  const [editing, setEditing] = useState<JournalDraft | null>(null),
    [detail, setDetail] = useState<JournalEntry | null>(null),
    [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(
      null,
    ),
    [menu, setMenu] = useState(false),
    [trash, setTrash] = useState(false),
    [draftList, setDraftList] = useState(false),
    [bookManage, setBookManage] = useState(false),
    [bookName, setBookName] = useState(""),
    [bookEdit, setBookEdit] = useState<string | null>(null),
    [confirm, setConfirm] = useState<{
      text: string;
      run: () => Promise<void>;
    } | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [undo, setUndo] = useState<JournalEntry | null>(null),
    [bytes, setBytes] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    busyRef = useRef(false),
    didCreate = useRef(false);
  const refresh = () => setRevision((n) => n + 1);
  const boot = useCallback(async () => {
    const data = await journal.boot();
    setBooks(data.books);
    setDrafts(
      data.drafts.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("journal-open");
    void boot().catch((e) => setError(e.message));
    return () => document.documentElement.classList.remove("journal-open");
  }, [boot]);
  useEffect(() => {
    if (create && !didCreate.current && books.length) {
      didCreate.current = true;
      setEditing(newJournal(today));
    }
  }, [books, create, today]);
  useEffect(() => {
    void boot().catch((e) => setError(e.message));
  }, [revision, boot]);
  const filters = useMemo<JournalFilter>(
    () => ({
      book_id: book,
      query: query.trim(),
      from: from || undefined,
      to: to || undefined,
      has_images: photos === "all" ? undefined : photos === "yes",
      min_rating: rating ? Number(rating) : undefined,
      max_rating: maxRating ? Number(maxRating) : undefined,
      trash,
    }),
    [book, query, from, to, photos, rating, maxRating, trash],
  );
  const activeSearch = Boolean(
      query || from || to || photos !== "all" || rating || maxRating,
    ),
    timeline = mode === "timeline" || activeSearch || trash;
  const listFilter = useMemo(
    () => ({ ...filters, date: timeline ? undefined : selected }),
    [filters, timeline, selected],
  );
  useEffect(() => {
    setPages([]);
    setCurrentCursor(null);
  }, [listFilter, revision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () => {
        journal
          .list(listFilter, currentCursor)
          .then((r) => {
            if (live) {
              setEntries(r.entries);
              setCursor(r.cursor);
              setLoading(false);
            }
          })
          .catch((e) => {
            if (live) {
              setError(e.message);
              setLoading(false);
            }
          });
      },
      query ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [listFilter, currentCursor, revision]);
  useEffect(() => {
    let live = true;
    journal
      .month({ ...filters, ...monthRange(month), trash: false })
      .then((r) => {
        if (live) setSummary(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [filters, month, revision]);
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const edit = (entry: JournalEntry) => {
    const existing = drafts.find((d) => d.entry.id === entry.id);
    setEditing(
      existing || {
        id: journalId(),
        entry: structuredClone(entry),
        base_version: entry.version,
        updated_at: new Date().toISOString(),
      },
    );
  };
  const pickDate = (date: string) => {
    setSelected(date);
    setMonth(date.slice(0, 7));
  };
  const closeDetail = () => setDetail(null);
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (busyRef.current) return;
    if (confirm) setConfirm(null);
    else if (bookManage) setBookManage(false);
    else if (draftList) setDraftList(false);
    else if (menu) setMenu(false);
    else if (detail) setDetail(null);
    else if (trash) setTrash(false);
    else if (searching || filterOpen) {
      setSearching(false);
      setFilterOpen(false);
    } else onClose();
  };
  useEffect(() => {
    const back = (e: Event) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      backRef.current();
    };
    window.addEventListener("todotree:back", back);
    return () => window.removeEventListener("todotree:back", back);
  }, []);
  const counts = new Map(summary.days.map((d) => [d.date, d.count]));
  const fullGrid = monthGrid(month);
  const weekStart = Math.floor(Math.max(0, fullGrid.indexOf(selected)) / 7) * 7;
  const grid = week ? fullGrid.slice(weekStart, weekStart + 7) : fullGrid;
  const deleteEntry = (entry: JournalEntry) =>
    run(async () => {
      const removed = await journal.mutate("delete", {
        id: entry.id,
        expected_version: entry.version,
      });
      setDetail(null);
      setUndo(removed);
      setNotice("已移入手帐回收站");
      refresh();
    });
  const moreItems = (
    <>
      <button
        onClick={() => {
          setMenu(false);
          setDraftList(true);
        }}
      >
        <NotebookPen size={19} />
        继续草稿 <span>{drafts.length}</span>
      </button>
      <button
        onClick={() => {
          setMenu(false);
          setBookManage(true);
        }}
      >
        <BookOpen size={19} />
        管理手帐本
      </button>
      <button
        onClick={() => {
          setMenu(false);
          setTrash(true);
          setDetail(null);
        }}
      >
        <Trash2 size={19} />
        手帐回收站
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r = await journal.export();
            if (!r.cancelled) {
              setNotice("手帐与原图备份已导出");
              setMenu(false);
            }
          })
        }
      >
        <Download size={19} />
        导出手帐与原图
      </button>
      <button
        disabled={busy}
        onClick={() =>
          setConfirm({
            text: "从 ZIP 恢复手帐。现有内容会保留，内容冲突将生成备份副本。",
            run: async () => {
              const r = await journal.import();
              if (!r.cancelled) {
                setNotice(
                  `已恢复 ${r.added || 0} 条，其中 ${r.conflicts || 0} 条为冲突副本`,
                );
                setMenu(false);
                refresh();
              }
            },
          })
        }
      >
        <Upload size={19} />
        恢复手帐备份
      </button>
    </>
  );
  return (
    <section className="j-shell" aria-label="生活手帐">
      <header className="j-header">
        <button
          className="j-icon"
          aria-label={trash ? "退出手帐回收站" : "返回任务"}
          disabled={busy}
          onClick={() => (trash ? setTrash(false) : onClose())}
        >
          <ArrowLeft />
        </button>
        <div>
          <h1>{trash ? "手帐回收站" : "生活手帐"}</h1>
          <small>
            {trash ? "随时恢复，没有自动清空" : "留住照片、事情和当时的感受"}
          </small>
        </div>
        <button
          className="j-icon"
          aria-label="搜索手帐"
          onClick={() => setSearching((v) => !v)}
        >
          <Search size={21} />
        </button>
        <button
          className="j-icon"
          aria-label="手帐更多"
          onClick={() => {
            setMenu(true);
            void journal
              .stats()
              .then((r) => setBytes(r.original_bytes))
              .catch(() => {});
          }}
        >
          <MoreHorizontal />
        </button>
      </header>
      <div className="j-controls">
        <select
          aria-label="筛选手帐本"
          value={book}
          onChange={(e) => setBook(e.target.value)}
        >
          <option value="">全部手帐</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {!trash && (
          <div className="j-segment">
            <button
              aria-pressed={mode === "calendar"}
              onClick={() => setMode("calendar")}
            >
              日历
            </button>
            <button
              aria-pressed={mode === "timeline"}
              onClick={() => setMode("timeline")}
            >
              时间线
            </button>
          </div>
        )}
        <button className="j-text" onClick={() => setFilterOpen((v) => !v)}>
          筛选{activeSearch ? " · 已启用" : ""}
        </button>
      </div>
      {searching && (
        <div className="j-search">
          <Search size={18} />
          <input
            aria-label="搜索手帐内容"
            placeholder="搜索事情、感受、地点或标签"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="j-icon"
            aria-label="清除搜索"
            onClick={() => setQuery("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {filterOpen && (
        <div className="j-filter">
          <label>
            起始日期
            <input
              aria-label="起始日期"
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            结束日期
            <input
              aria-label="结束日期"
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            图片
            <select
              aria-label="图片筛选"
              value={photos}
              onChange={(e) => setPhotos(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="yes">有图片</option>
              <option value="no">纯文字或评价</option>
            </select>
          </label>
          <label>
            最低评分
            <select
              aria-label="最低评分"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            >
              <option value="">不限</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            最高评分
            <select
              aria-label="最高评分"
              value={maxRating}
              onChange={(e) => setMaxRating(e.target.value)}
            >
              <option value="">不限</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setFrom("");
              setTo("");
              setPhotos("all");
              setRating("");
              setMaxRating("");
              setQuery("");
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      {error && (
        <div className="j-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              refresh();
            }}
          >
            重试
          </button>
        </div>
      )}
      {busy && (
        <div className="j-status" role="status">
          正在处理，请勿关闭应用…
        </div>
      )}
      <div className="j-scroll" ref={scroll}>
        {!trash && !timeline && (
          <section className="j-calendar" aria-label="手帐日历">
            <div className="j-month-title">
              <strong>
                {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
              </strong>
              <div>
                <button
                  className="j-icon"
                  aria-label="上个月"
                  onClick={() => {
                    const m = shiftMonth(month, -1);
                    setMonth(m);
                    setSelected(m + "-01");
                  }}
                >
                  <ChevronLeft size={20} />
                </button>
                <button className="j-text" onClick={() => pickDate(today)}>
                  今天
                </button>
                <button
                  className="j-icon"
                  aria-label="下个月"
                  disabled={month >= today.slice(0, 7)}
                  onClick={() => {
                    const m = shiftMonth(month, 1);
                    setMonth(m);
                    setSelected(m === today.slice(0, 7) ? today : m + "-01");
                  }}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            <div className="j-weekdays">
              {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="j-days">
              {grid.map((date) => (
                <button
                  key={date}
                  aria-label={`${date}，${counts.get(date) || 0} 条记录`}
                  aria-selected={date === selected}
                  disabled={date > today}
                  className={`${date === today ? "is-today" : ""} ${date.slice(0, 7) !== month ? "outside" : ""}`}
                  onClick={() => pickDate(date)}
                >
                  <span>{Number(date.slice(-2))}</span>
                  {counts.has(date) ? (
                    <small>
                      {counts.get(date)! > 99 ? "99+" : counts.get(date)} 条
                    </small>
                  ) : (
                    <small> </small>
                  )}
                </button>
              ))}
            </div>
            <div className="j-month-stats">
              <span>
                记录 {summary.days.length} 天 · {summary.count} 件事 ·{" "}
                {summary.image_count} 张照片
              </span>
              <button onClick={() => setWeek((v) => !v)}>
                {week ? "展开月历" : "收起月历"}
              </button>
            </div>
          </section>
        )}
        {!trash && drafts.length > 0 && (
          <button className="j-draft-banner" onClick={() => setDraftList(true)}>
            <NotebookPen size={18} />
            继续未写完的草稿{" "}
            <span>
              {drafts.length} 份 <ChevronRight size={16} />
            </span>
          </button>
        )}
        <div className="j-section-title">
          <h2>
            {trash
              ? "回收站"
              : timeline
                ? activeSearch
                  ? "匹配的记录"
                  : books.find((b) => b.id === book)?.name ||
                    "那些值得记住的日子"
                : selected === today
                  ? "今天的记录"
                  : `${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(-2))} 日`}
          </h2>
          {!trash && !timeline && (
            <button
              className="j-text"
              onClick={() => setEditing(newJournal(selected, book || "daily"))}
            >
              ＋ {selected === today ? "记一笔" : "补记"}
            </button>
          )}
        </div>
        {loading ? (
          <div className="j-empty">正在翻开手帐…</div>
        ) : entries.length === 0 ? (
          <div className="j-empty">
            <BookOpen size={36} />
            <h3>
              {activeSearch
                ? "没有匹配记录"
                : trash
                  ? "回收站是空的"
                  : timeline
                    ? "还没有留下记录"
                    : selected === today
                      ? "今天有什么值得记下？"
                      : "这一天还没有记录"}
            </h3>
            <p>
              {activeSearch
                ? "试试减少筛选条件。"
                : trash
                  ? "删除的事件会先保存在这里。"
                  : "一句话、一张照片，都可以成为一页回忆。"}
            </p>
            {!trash && !activeSearch && (
              <button
                className="j-primary"
                onClick={() =>
                  setEditing(
                    newJournal(timeline ? today : selected, book || "daily"),
                  )
                }
              >
                {selected === today || timeline ? "开始记录" : "补记这一天"}
              </button>
            )}
          </div>
        ) : (
          entries.map((e, i) => (
            <React.Fragment key={e.id}>
              {timeline &&
                (i === 0 || entries[i - 1].event_date !== e.event_date) && (
                  <h3 className="j-feed-date">{e.event_date}</h3>
                )}
              <button
                className="j-card"
                onClick={() =>
                  void run(async () => setDetail(await journal.get(e.id)))
                }
              >
                {e.images.length > 0 && (
                  <div className="j-cover">
                    <JournalImage id={e.cover_attachment_id || e.images[0]} />
                    <span>{e.images.length} 张</span>
                  </div>
                )}
                <div className="j-card-body">
                  <small>
                    {e.event_time || "未标时间"}
                    {e.location_text ? ` · ${e.location_text}` : ""}
                  </small>
                  <h3>{journalTitle(e)}</h3>
                  {e.title && e.description && <p>{e.description}</p>}
                  {e.reflection && (
                    <p className="j-reflection">{e.reflection}</p>
                  )}
                  <div className="j-card-meta">
                    <span>
                      {books.find((b) => b.id === e.book_id)?.name || "日常"}
                    </span>
                    {e.rating !== null && (
                      <span className="j-rating">
                        <Star size={13} fill="currentColor" />
                        {e.rating}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </React.Fragment>
          ))
        )}
        {(pages.length > 0 || cursor) && (
          <div className="j-pagination">
            <button
              disabled={!pages.length}
              onClick={() => {
                setCurrentCursor(pages[pages.length - 1]);
                setPages((p) => p.slice(0, -1));
                scroll.current?.scrollTo({ top: 0 });
              }}
            >
              上一页
            </button>
            <span>第 {pages.length + 1} 页</span>
            <button
              disabled={!cursor}
              onClick={() => {
                setPages((p) => [...p, currentCursor]);
                setCurrentCursor(cursor);
                scroll.current?.scrollTo({ top: 0 });
              }}
            >
              更早的记录
            </button>
          </div>
        )}
      </div>
      {!trash && (
        <footer className="j-compose-bar">
          <button
            className="j-primary"
            onClick={() =>
              setEditing(
                newJournal(timeline ? today : selected, book || "daily"),
              )
            }
          >
            <Plus size={21} />
            记一笔
          </button>
        </footer>
      )}
      {notice && (
        <div className="j-toast" role="status">
          <span>{notice}</span>
          {undo && (
            <button
              onClick={() =>
                void run(async () => {
                  await journal.mutate("restore", {
                    id: undo.id,
                    expected_version: undo.version,
                  });
                  setUndo(null);
                  setNotice("已恢复记录");
                  refresh();
                })
              }
            >
              撤销
            </button>
          )}
          <button
            aria-label="关闭提示"
            onClick={() => {
              setNotice("");
              setUndo(null);
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {detail && (
        <section className="j-page j-detail" aria-label="手帐详情">
          <header className="j-header">
            <button
              className="j-icon"
              aria-label="返回手帐列表"
              onClick={closeDetail}
            >
              <ArrowLeft />
            </button>
            <div>
              <h1>{detail.event_date}</h1>
              <small>
                {books.find((b) => b.id === detail.book_id)?.name || "日常"}
              </small>
            </div>
            {!detail.deleted_at && (
              <button className="j-text" onClick={() => edit(detail)}>
                编辑
              </button>
            )}
          </header>
          <div className="j-scroll j-detail-body">
            <h2>{journalTitle(detail)}</h2>
            <small>
              {detail.event_time || "未标时间"}
              {detail.location_text ? ` · ${detail.location_text}` : ""}
            </small>
            {detail.description && (
              <p className="j-prose">{detail.description}</p>
            )}
            {detail.images.map((id, i) => (
              <button
                key={id}
                className="j-detail-photo"
                onClick={() => setViewer({ images: detail.images, index: i })}
              >
                <JournalImage id={id} large />
              </button>
            ))}
            {detail.reflection && (
              <blockquote>
                <span>当时的感受</span>
                <p className="j-prose">{detail.reflection}</p>
              </blockquote>
            )}
            {detail.rating !== null && (
              <p className="j-rating">
                {"★".repeat(detail.rating)} · 这次体验 {detail.rating} 分
              </p>
            )}
            {detail.tags.length > 0 && (
              <div className="j-tags">
                {detail.tags.map((t, i) => (
                  <span key={i}>#{t}</span>
                ))}
              </div>
            )}
            <p className="j-muted">
              记录于 {new Date(detail.created_at).toLocaleString("zh-CN")} ·
              事件日期 {detail.event_date}
            </p>
            {detail.deleted_at ? (
              <div className="j-detail-actions">
                <button
                  className="j-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await journal.mutate("restore", {
                        id: detail.id,
                        expected_version: detail.version,
                      });
                      setDetail(null);
                      setNotice("已恢复到原日期");
                      refresh();
                    })
                  }
                >
                  恢复记录
                </button>
                <button
                  className="j-danger"
                  onClick={() =>
                    setConfirm({
                      text: "永久删除这条记录？独占的原图会在后台清理，无法撤销。",
                      run: async () => {
                        await journal.mutate("purge", { id: detail.id });
                        setDetail(null);
                        refresh();
                      },
                    })
                  }
                >
                  永久删除
                </button>
              </div>
            ) : (
              <div className="j-detail-actions">
                <button
                  onClick={() => {
                    setTrash(false);
                    setMode("calendar");
                    setQuery("");
                    setFrom("");
                    setTo("");
                    setPhotos("all");
                    setRating("");
                    setMaxRating("");
                    setBook(detail.book_id);
                    pickDate(detail.event_date);
                    setDetail(null);
                  }}
                >
                  定位到日历
                </button>
                {detail.images.length > 0 && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        const b = books.find((b) => b.id === detail.book_id)!;
                        await journal.mutate("saveBook", {
                          book: {
                            ...b,
                            cover_attachment_id:
                              detail.cover_attachment_id || detail.images[0],
                          },
                        });
                        await boot();
                        setNotice("已设为手帐本封面");
                      })
                    }
                  >
                    设为手帐本封面
                  </button>
                )}
                <button
                  className="j-danger"
                  disabled={busy}
                  onClick={() => void deleteEntry(detail)}
                >
                  移入回收站
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      {menu && (
        <div
          className="j-modal-backdrop"
          onClick={() => !busy && setMenu(false)}
        >
          <section
            className="j-modal j-menu"
            role="dialog"
            aria-label="手帐功能"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>我的生活手帐</h2>
              <button className="j-icon" onClick={() => setMenu(false)}>
                <X />
              </button>
            </header>
            {moreItems}
            {error && (
              <p className="j-error" role="alert">
                {error}
              </p>
            )}
            <p>
              原图占用 {bytes === null ? "…" : (bytes / 1024 / 1024).toFixed(1)}{" "}
              MiB。数据只保存在此设备，任务 JSON 备份不包含手帐。
            </p>
            {busy && <p role="status">正在处理备份，请稍候…</p>}
          </section>
        </div>
      )}
      {draftList && (
        <div className="j-modal-backdrop">
          <section className="j-modal" role="dialog" aria-label="手帐草稿">
            <header>
              <h2>未写完的草稿</h2>
              <button className="j-icon" onClick={() => setDraftList(false)}>
                <X />
              </button>
            </header>
            {!drafts.length ? (
              <p>没有草稿</p>
            ) : (
              drafts.map((d) => (
                <button
                  className="j-draft-row"
                  key={d.id}
                  onClick={() => {
                    setDraftList(false);
                    setEditing(d);
                  }}
                >
                  <strong>{journalTitle(d.entry)}</strong>
                  <small>
                    {d.entry.event_date} · {d.entry.images.length} 张照片
                  </small>
                </button>
              ))
            )}
          </section>
        </div>
      )}
      {bookManage && (
        <div className="j-modal-backdrop">
          <section className="j-modal" role="dialog" aria-label="管理手帐本">
            <header>
              <h2>我的手帐本</h2>
              <button className="j-icon" onClick={() => setBookManage(false)}>
                <X />
              </button>
            </header>
            {error && (
              <p className="j-error" role="alert">
                {error}
              </p>
            )}
            {books.map((b) => (
              <div className="j-book-row" key={b.id}>
                {b.cover_attachment_id ? (
                  <JournalImage id={b.cover_attachment_id} />
                ) : (
                  <BookOpen />
                )}
                <button
                  onClick={() => {
                    setBook(b.id);
                    setMode("timeline");
                    setBookManage(false);
                  }}
                >
                  {b.name}
                </button>
                {b.id !== "daily" && (
                  <>
                    <button
                      onClick={() => {
                        setBookEdit(b.id);
                        setBookName(b.name);
                      }}
                    >
                      改名
                    </button>
                    <button
                      className="j-danger"
                      onClick={() =>
                        setConfirm({
                          text: `删除“${b.name}”手帐本？其中的记录会保留并归入“日常”。`,
                          run: async () => {
                            await journal.mutate("deleteBook", { id: b.id });
                            if (book === b.id) setBook("daily");
                            refresh();
                          },
                        })
                      }
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="j-inline">
              <input
                aria-label="手帐本名称"
                placeholder="例如：贵阳之旅"
                value={bookName}
                maxLength={60}
                onChange={(e) => setBookName(e.target.value)}
              />
              <button
                disabled={!bookName.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    const old = books.find((b) => b.id === bookEdit);
                    await journal.mutate("saveBook", {
                      book: {
                        ...old,
                        id: old?.id || journalId(),
                        name: bookName.trim(),
                        created_at: old?.created_at || new Date().toISOString(),
                      },
                    });
                    setBookName("");
                    setBookEdit(null);
                    refresh();
                  })
                }
              >
                {bookEdit ? "保存名称" : "新建"}
              </button>
            </div>
          </section>
        </div>
      )}
      {editing && (
        <JournalEditor
          key={editing.id}
          draft={editing}
          books={books}
          onBook={boot}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
          onSaved={(e) => {
            setEditing(null);
            setDetail(null);
            setTrash(false);
            pickDate(e.event_date);
            setMode("calendar");
            setBook(e.book_id);
            setQuery("");
            setFrom("");
            setTo("");
            setPhotos("all");
            setRating("");
            setMaxRating("");
            setNotice("已保存这段回忆");
            refresh();
          }}
        />
      )}
      {viewer && <JournalViewer {...viewer} onClose={() => setViewer(null)} />}
      {confirm && (
        <div className="j-modal-backdrop j-confirm">
          <section className="j-modal" role="alertdialog">
            <h2>请确认</h2>
            <p>{confirm.text}</p>
            {error && (
              <p className="j-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="j-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await confirm.run();
                  setConfirm(null);
                })
              }
            >
              {busy ? "处理中…" : "确认"}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
