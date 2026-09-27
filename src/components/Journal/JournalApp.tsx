import { AppModeSwitch, rememberMode } from '../AppModeSwitch';
import { JournalCarousel } from './JournalCarousel';
import { JournalTree } from './JournalTree';
function readJournalView(): any { try {return JSON.parse(localStorage.getItem('todotree.journal.view.v1')||'{}');}catch{return {};}}
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
  const savedView = useRef(readJournalView()).current;
  const [dayExpanded,setDayExpanded]=useState<Set<string>>(new Set());
  const treeGuard=useRef<(()=>Promise<boolean>)|null>(null);
  const positions=useRef<Record<string,number>>((()=>{try{return JSON.parse(localStorage.getItem('todotree.journal.scroll.v1')||'{}');}catch{return {};}})());
  const scrollTimer=useRef<ReturnType<typeof setTimeout>>();
  const today = journalToday(),
    [selected, setSelected] = useState<string>(savedView.selected && savedView.selected<=today ? savedView.selected:today),
    [month, setMonth] = useState<string>(/^\d{4}-\d{2}$/.test(savedView.month||'')&&savedView.month<=today.slice(0,7)?savedView.month:today.slice(0,7)),
    [week, setWeek] = useState(savedView.week !== false),
    [mode, setMode] = useState<"calendar" | "timeline" | "tree">(["calendar","timeline","tree"].includes(savedView.mode)?savedView.mode:"calendar");
  const [books, setBooks] = useState<JournalBook[]>([]),
    [drafts, setDrafts] = useState<JournalDraft[]>([]),
    [book, setBook] = useState<string>(savedView.book || ""),
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
    [viewer, setViewer] = useState<{ images: string[]; index: number; entry?:JournalEntry } | null>(
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
    [undo, setUndo] = useState<string | null>(null),
    [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => {
        setNotice("");
        setUndo(null);
      },
      undo ? 10000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [notice, undo]);
  const scroll = useRef<HTMLDivElement>(null),
    busyRef = useRef(false),
    didCreate = useRef(false);
  const scrollKey=`${mode}:${book}:${selected}`;
  const saveScroll=()=>{if(!scroll.current)return;positions.current[scrollKey]=scroll.current.scrollTop;clearTimeout(scrollTimer.current);scrollTimer.current=setTimeout(()=>{try{localStorage.setItem('todotree.journal.scroll.v1',JSON.stringify(Object.fromEntries(Object.entries(positions.current).slice(-30))));}catch{}},250);};
  useEffect(()=>{if(loading)return;const frame=requestAnimationFrame(()=>scroll.current?.scrollTo({top:positions.current[scrollKey]||0}));return()=>cancelAnimationFrame(frame);},[loading,scrollKey]);
  const refresh = () => setRevision((n) => n + 1);
  const changed = (message:string, undoId?:string) => {setNotice(message);setUndo(undoId||null);refresh();};
  useEffect(()=>{ try {localStorage.setItem('todotree.journal.view.v1',JSON.stringify({selected,month,week,mode,book}));} catch {} },[selected,month,week,mode,book]);
  const leave = async () => { if(busyRef.current || (treeGuard.current && !(await treeGuard.current())))return; onClose(); };
  const openDetail = async (entry:JournalEntry) => { if(treeGuard.current && !(await treeGuard.current()))return;setDetail(await journal.get(entry.id)); };
  useEffect(()=>{ if(!detail)return;let live=true;journal.get(detail.id).then(e=>live&&setDetail(e)).catch(()=>{if(live)setDetail(null);});return()=>{live=false;}; },[revision]);

  const boot = useCallback(async () => {
    const data = await journal.boot();
    setBooks(data.books);
    setBook(current=>data.books.some(b=>b.id===current)?current:'');
    rememberMode('journal');
    setDrafts(
      data.drafts.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("journal-open");
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
  const closeDetail = async () => { if(treeGuard.current && !(await treeGuard.current()))return;setDetail(null); };
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (busyRef.current) return;
    if (confirm) setConfirm(null);
    else if (bookManage) setBookManage(false);
    else if (draftList) setDraftList(false);
    else if (menu) setMenu(false);
    else if (detail) void closeDetail();
    else if (trash) setTrash(false);
    else if (searching || filterOpen) {
      setSearching(false);
      setFilterOpen(false);
    } else void leave();
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
  const deleteEntry = (entry: JournalEntry) => run(async () => {
    const info=await journal.branch(entry.id);
    const remove=async()=>{
      const removed=await journal.mutate('delete',{id:entry.id,expected_version:entry.version,expected_count:info.count});
      setDetail(null);changed('已移入手帐回收站',removed.operation_id);
    };
    if(info.count)setConfirm({text:`将移入回收站：1 个事件及 ${info.count} 条细节。可整组撤销。`,run:remove});
    else await remove();
  });
  const projectedChildren=(e:JournalEntry)=>entries.filter(child=>child.parent_id===e.id&&child.event_date===e.event_date);
  const projectionRoots=entries.filter(e=>!entries.some(parent=>parent.id===e.parent_id&&parent.event_date===e.event_date));
  const renderDayDetails=(e:JournalEntry,depth=0):React.ReactNode=><div className="j-day-details">{projectedChildren(e).map(child=><div key={child.id}>
    <button onClick={()=>void run(async()=>setDetail(await journal.get(child.id)))}><span>{journalTitle(child)}</span><small>{child.event_time||''}{child.images.length?` · ${child.images.length} 张照片`:''}</small><ChevronRight size={15}/></button>
    {depth<1&&renderDayDetails(child,depth+1)}
  </div>)}</div>;
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
      {!detail && !editing && !trash && <AppModeSwitch mode="journal" disabled={busy} onChange={()=>void leave()} /> }
      <header className="j-header">
        <button
          className="j-icon"
          hidden={!trash}
          aria-label={trash ? "退出手帐回收站" : "返回任务"}
          disabled={busy}
          onClick={() => (trash ? setTrash(false) : void leave())}
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
            <button aria-pressed={mode==='tree'} onClick={()=>{setMode('tree');setQuery('');setFrom('');setTo('');setPhotos('all');setRating('');setMaxRating('');}}>事件树</button>
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
      <div className="j-scroll" ref={scroll} onScroll={saveScroll}>
        {!trash && !timeline && mode!=="tree" && (
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
                记录 {summary.days.length} 天 · {summary.count} 条记录 ·{" "}
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
        {(mode !== 'tree' || activeSearch || trash) && <div className="j-section-title">
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
          {!trash && !timeline && mode!=="tree" && (
            <button
              className="j-text"
              onClick={() => setEditing(newJournal(selected, book || "daily"))}
            >
              ＋ {selected === today ? "记一笔" : "补记"}
            </button>
          )}
        </div>}
        {mode==='tree' && !activeSearch && !trash ? (detail ? null : <JournalTree root={null} book={book} books={books} revision={revision} onOpen={e=>void openDetail(e).catch(err=>setError(err.message))} onEditDraft={setEditing} onChange={changed} guard={treeGuard}/>) : loading ? (
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
          projectionRoots.map((e, i) => (
            <React.Fragment key={e.id}>
              {timeline &&
                (i === 0 || projectionRoots[i - 1].event_date !== e.event_date) && (
                  <h3 className="j-feed-date">{e.event_date}</h3>
                )}
              <article className="j-card" data-j-card={e.id}>
                {e.path && e.path.length>0 && <button className="j-card-path" onClick={()=>void run(async()=>setDetail(await journal.get(e.path![0].id)))}>{e.path.map(p=>p.title).join(' / ')} · 查看完整事件</button>}
                <JournalCarousel entry={e} onOpen={(images,index)=>setViewer({images,index,entry:e})}/>
                <button className="j-card-body" onClick={()=>void run(async()=>setDetail(await journal.get(e.id)))}>
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
                  {!!e.child_count && <span className="j-card-children">{e.child_count} 条细节 · 展开完整事件 ›</span>}
                </button>
                {projectedChildren(e).length>0 && <><button className="j-day-expand" aria-expanded={dayExpanded.has(e.id)} onClick={()=>setDayExpanded(old=>{const next=new Set(old);next.has(e.id)?next.delete(e.id):next.add(e.id);return next;})}>{dayExpanded.has(e.id)?'收起':'展开'}当页 {projectedChildren(e).length} 条细节</button>{dayExpanded.has(e.id)&&renderDayDetails(e)}</>}
                {!!e.other_date_count && <button className="j-other-days" onClick={()=>void run(async()=>setDetail(await journal.get(e.id)))}>另有 {e.other_date_count} 条其他日期记录 · 查看完整事件</button>}
              </article>
            </React.Fragment>
          ))
        )}
        {mode!=="tree" && (pages.length > 0 || cursor) && (
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
                  await journal.mutate("undo", {undo_id:undo});
                  setUndo(null);
                  setNotice("已撤销操作");
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
                onClick={() => setViewer({ images: detail.images, index: i, entry:detail })}
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
            {!detail.deleted_at && <JournalTree root={detail} book={detail.book_id} books={books} revision={revision} onOpen={e=>void openDetail(e).catch(err=>setError(err.message))} onEditDraft={setEditing} onChange={changed} guard={treeGuard}/>}
            {detail.deleted_at ? (
              <div className="j-detail-actions">
                <button
                  className="j-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const recovered = await journal.mutate("restore", {
                        id: detail.id,
                        expected_version: detail.version,
                      });
                      setDetail(null);
                      setNotice(recovered.restored_as_root ? "原父事件已不可用，已恢复为独立事件" : "已恢复到原日期");
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
                      text: "永久删除这条记录及其回收站内细节？独占原图会在后台清理，无法撤销。",
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
            if(e.parent_id) {void journal.get(e.parent_id).then(setDetail).catch(()=>setDetail(null));setNotice('已保存细节');refresh();return;}
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
      {viewer && <JournalViewer {...viewer} coverId={viewer.entry?.cover_attachment_id||viewer.entry?.images[0]||null} onClose={() => setViewer(null)}
        onSetCover={viewer.entry && !viewer.entry.deleted_at ? async (id)=>{
          const fresh=await journal.get(viewer.entry!.id);
          const result=await journal.mutate('setCover',{id:fresh.id,expected_version:fresh.version,attachment_id:id});
          setViewer(v=>v?{...v,entry:{...fresh,cover_attachment_id:id,version:result.version}}:v);changed('已设为封面',result.operation_id);
        }:undefined}/>}
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
