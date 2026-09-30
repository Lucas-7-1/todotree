import React, {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,GripVertical,Plus,MoreHorizontal,X,ArrowUpLeft} from 'lucide-react';
import {journal} from '../../services/journal/store';
import {JournalBook,JournalDraft,JournalEntry,journalTitle,journalToday,newJournalChild,JournalSort,JournalDirection,expenseLabel} from '../../services/journal/model';
import {JournalImage} from './JournalImage';
interface Props {
  root:JournalEntry|null; book:string; books:JournalBook[]; revision:number;
  onOpen:(entry:JournalEntry)=>void; onEditDraft:(draft:JournalDraft)=>void;
  onChange:(message:string,undoId?:string)=>void;
  guard:{current:(()=>Promise<boolean>)|null};
}
type Page={entries:JournalEntry[];total:number};
type Drop={parent_id:string|null;book_id:string;before_id?:string|null;target_version?:number;label:string};
const key=(id:string|null)=>id||'@roots';
export function JournalTree(p:Props) {
  const [pages,setPages]=useState<Record<string,Page>>({}), [expanded,setExpanded]=useState<Set<string>>(()=>{try{return new Set(JSON.parse(localStorage.getItem('todotree.journal.expanded.v1')||'[]').slice(0,100));}catch{return new Set();}});
  const [sort,setSort]=useState<JournalSort>(()=>{try{return localStorage.getItem('todotree.journal.sort.v1')==='created'?'created':'event';}catch{return 'event';}});
  const [direction,setDirection]=useState<JournalDirection>(()=>{try{return localStorage.getItem('todotree.journal.direction.v1')==='desc'?'desc':'asc';}catch{return 'asc';}});
  const [organize,setOrganize]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState<JournalEntry|null>(null),[move,setMove]=useState<JournalEntry|null>(null);
  const [inline,setInline]=useState<JournalDraft|null>(null),[floating,setFloating]=useState<{entry:JournalEntry;x:number;y:number}|null>(null),[drop,setDrop]=useState<Drop|null>(null);
  const latest=useRef(inline),queue=useRef(Promise.resolve()),dirty=useRef(false),lock=useRef(false),el=useRef<HTMLDivElement>(null),generation=useRef(0),alive=useRef(true);
  latest.current=inline;
  const [moveBook,setMoveBook]=useState(p.book||p.root?.book_id||'daily'),[moveParent,setMoveParent]=useState<JournalEntry|null>(null),[choices,setChoices]=useState<JournalEntry[]>([]),[search,setSearch]=useState('');
  const [choiceCursor,setChoiceCursor]=useState<any>(null),[choiceOffset,setChoiceOffset]=useState(0),[choiceTotal,setChoiceTotal]=useState(0),[moveCount,setMoveCount]=useState(0);
  const load=async(id:string|null,append=false)=>{
    const epoch=generation.current, offset=append?(pages[key(id)]?.entries.length||0):0;
    try {const data=await journal.children(id,p.book||p.root?.book_id||'',offset,sort,direction);if(epoch!==generation.current||!alive.current)return;
      setPages(old=>({...old,[key(id)]:{...data,entries:append?[...(old[key(id)]?.entries||[]),...data.entries]:data.entries}}));
    }catch(e){if(alive.current)setError((e as Error).message);}
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{generation.current++;setPages({});void load(p.root?.id||null);for(const id of expanded)void load(id);},[p.root?.id,p.book,p.revision,sort,direction]);
  useEffect(()=>{try{localStorage.setItem('todotree.journal.sort.v1',sort);localStorage.setItem('todotree.journal.direction.v1',direction);}catch{}},[sort,direction]);
  useEffect(()=>{try{localStorage.setItem('todotree.journal.expanded.v1',JSON.stringify([...expanded].slice(-100)));}catch{}},[expanded]);
  const flush=async()=>{
    if(!dirty.current)return queue.current;
    const d=latest.current;if(!d)return;
    dirty.current=false;
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      try{if(d.entry.title.trim())await journal.mutate('saveDraft',{draft:d});else await journal.mutate('discardDraft',{id:d.id});}
      catch(e){dirty.current=true;throw e;}
    });return queue.current;
  };
  const safeLeave=async()=>{if(lock.current)return false;try{await flush();return true;}catch(e){setError('草稿保存失败，请重试：'+(e as Error).message);return false;}};
  p.guard.current=safeLeave;
  useEffect(()=>{const t=setTimeout(()=>void flush().catch(e=>setError(e.message)),800);return()=>clearTimeout(t);},[inline]);
  const handlers=useRef({flush,safeLeave});handlers.current={flush,safeLeave};
  useEffect(()=>{const hide=()=>{if(document.hidden)void handlers.current.flush().catch(()=>{});};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);p.guard.current=null;};},[]);
  const perform=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await flush();await fn();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}};
  const toggle=(e:JournalEntry)=>{const next=new Set(expanded);if(next.has(e.id))next.delete(e.id);else {next.add(e.id);void load(e.id);}setExpanded(next);};
  const add=async(e:JournalEntry)=>{
    if(!(await safeLeave()))return;
    if((e.path?.length||0)>=4){setError('已到第 5 层，可在上一级新增细节');return;}
    const parent=await journal.get(e.id);const d=newJournalChild(parent);if((e.path?.length||0)-(p.root?(p.root.path?.length||0):-1)>=3){p.onEditDraft(d);return;}setInline(d);latest.current=d;dirty.current=false;
    setExpanded(old=>new Set([...old,e.id]));void load(e.id);
  };
  const commit=()=>perform(async()=>{
    const d=latest.current;if(!d?.entry.title.trim())return;
    await journal.mutate('publish',{entry:d.entry,expected_version:0,draft_id:d.id});dirty.current=false;setInline(null);latest.current=null;
    p.onChange('已添加细节');
  });
  const doMove=async(e:JournalEntry,target:Drop)=>perform(async()=>{
    const r=await journal.mutate('move',{id:e.id,expected_version:e.version,...target});
    setMove(null);setMenu(null);setExpanded(old=>new Set([...old,...(target.parent_id?[target.parent_id]:[])]));
    p.onChange('已移动，日期和照片保持原样',r.operation_id);
  });
  const beginMove=async(e:JournalEntry)=>{if(!(await safeLeave()))return;setMenu(null);setMove(e);setMoveBook(e.book_id);setMoveParent(null);setSearch('');setChoiceOffset(0);const b=await journal.branch(e.id);setMoveCount(b.count);};
  useEffect(()=>{
    if(!move)return;let live=true;
    const t=setTimeout(()=>{const request=search.trim()?journal.list({book_id:moveBook,query:search.trim()}):journal.children(moveParent?.id||null,moveBook);
      request.then((r:any)=>{if(live){setChoices(r.entries);setChoiceCursor(r.cursor||null);setChoiceOffset(r.entries.length);setChoiceTotal(r.total||0);}}).catch(e=>live&&setError(e.message));},search?180:0);
    return()=>{live=false;clearTimeout(t);};
  },[move?.id,moveBook,moveParent?.id,search]);
  const drag=useRef<{node:JournalEntry;pointer:number;x:number;y:number;active:boolean;timer:ReturnType<typeof setTimeout>;hover:string;since:number;drop:Drop|null}|null>(null);
  const dragHandlers=useRef({doMove,toggle});dragHandlers.current={doMove,toggle};
  useEffect(()=>{
    let frame=0;
    const preview=()=>{
      const s=drag.current;if(!s?.active)return;
      const hit=document.elementFromPoint(s.x,s.y)?.closest<HTMLElement>('[data-j-node],[data-j-drop-parent]');
      s.drop=null;
      if(hit&&el.current?.contains(hit)) {
        if(hit.hasAttribute('data-j-drop-parent')) { s.hover='';s.drop={parent_id:hit.dataset.jDropParent||null,book_id:s.node.book_id,label:'移出为'+(hit.dataset.jDropParent?'上一级细节':'独立事件')}; }
        else {const target=JSON.parse(hit.dataset.jEntry!) as JournalEntry;
          const illegal=target.id===s.node.id||target.path?.some(p=>p.id===s.node.id);
          if(!illegal) {
            if(s.hover!==target.id){s.hover=target.id;s.since=performance.now();}
            if(performance.now()-s.since>=350) {
              s.drop={parent_id:target.id,book_id:target.book_id,target_version:target.version,label:'放入「'+journalTitle(target)+'」 · 按时间落位'};
            }
          } else {s.hover='';}
        }
      }else s.hover='';
      setDrop(old=>old?.parent_id===s.drop?.parent_id&&old?.label===s.drop?.label?old:s.drop);
      const scroller=el.current?.closest<HTMLElement>('.j-scroll');
      if(scroller){const r=scroller.getBoundingClientRect();const edge=50;const speed=s.y<r.top+edge?-Math.min(12,(r.top+edge-s.y)/4):s.y>r.bottom-edge?Math.min(12,(s.y-r.bottom+edge)/4):0;if(speed)scroller.scrollTop+=speed;}
      frame=requestAnimationFrame(preview);
    };
    const update=(event:PointerEvent)=>{
      const s=drag.current;if(!s||event.pointerId!==s.pointer)return;
      if(!s.active){if(Math.hypot(event.clientX-s.x,event.clientY-s.y)>10){clearTimeout(s.timer);drag.current=null;}return;}
      event.preventDefault();s.x=event.clientX;s.y=event.clientY;setFloating({entry:s.node,x:s.x,y:s.y});
    };
    const end=(e:PointerEvent)=>{const s=drag.current;if(!s||e.pointerId!==s.pointer)return;clearTimeout(s.timer);cancelAnimationFrame(frame);drag.current=null;document.documentElement.classList.remove('journal-dragging');setFloating(null);setDrop(null);if(s.active&&s.drop&&e.type!=='pointercancel')void dragHandlers.current.doMove(s.node,s.drop);};
    const launch=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(preview);};
    el.current?.addEventListener('j-drag-start',launch);
    document.addEventListener('pointermove',update,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
    return()=>{document.documentElement.classList.remove('journal-dragging');if(drag.current)clearTimeout(drag.current.timer);cancelAnimationFrame(frame);el.current?.removeEventListener('j-drag-start',launch);document.removeEventListener('pointermove',update);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);};
  },[]);
  const start=(e:React.PointerEvent,node:JournalEntry)=>{
    if(busy||inline)return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    const state={node,pointer:e.pointerId,x:e.clientX,y:e.clientY,active:false,timer:0 as unknown as ReturnType<typeof setTimeout>,hover:'',since:0,drop:null as Drop|null};
    state.timer=setTimeout(()=>{state.active=true;document.documentElement.classList.add('journal-dragging');setFloating({entry:node,x:state.x,y:state.y});el.current?.dispatchEvent(new Event('j-drag-start'));navigator.vibrate?.(10);},300);drag.current=state;
  };
  const inlineRow=(parentId:string)=>inline?.entry.parent_id===parentId?<div className="j-inline-detail" key="draft">
    <input autoFocus aria-label="新细节" placeholder="写一句细节…" value={inline.entry.title} maxLength={100} disabled={busy}
      onChange={e=>{dirty.current=true;const next={...inline,entry:{...inline.entry,title:e.target.value}};latest.current=next;setInline(next);}}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void commit();}if(e.key==='Escape')void safeLeave().then(ok=>{if(ok)setInline(null);});}}/>
    <div><span>{inline.entry.event_date}</span>{inline.entry.event_date!==journalToday()&&<button onClick={()=>{dirty.current=true;setInline(d=>d?{...d,entry:{...d.entry,event_date:journalToday()}}:d);}}>改为今天</button>}
      <button disabled={busy} onClick={()=>void safeLeave().then(ok=>{if(ok&&latest.current)p.onEditDraft(latest.current);})}>图片 / 更多</button>
      <button disabled={busy||!inline.entry.title.trim()} onClick={()=>void commit()}>保存</button>
      <button disabled={busy} onClick={()=>void safeLeave().then(ok=>{if(ok){setInline(null);latest.current=null;}})}>收起</button></div>
  </div>:null;
  const renderChildren=(parentId:string|null,depth:number):React.ReactNode=>{
    const page=pages[key(parentId)];if(!page)return <p className="j-muted">正在加载细节…</p>;
    return <div className={depth?'j-tree-children':'j-tree-roots'}>{page.entries.map((e,i)=><React.Fragment key={e.id}>
      <div className={`j-tree-row ${drop?.parent_id===e.id?'is-drop':''} ${floating?.entry.id===e.id?'is-lifted':''}`} data-j-node={e.id} data-j-entry={JSON.stringify(e)} data-j-next={page.entries[i+1]?.id||''}>
        <button className="j-tree-toggle" aria-label={`展开细节：${journalTitle(e)}`} aria-expanded={expanded.has(e.id)} disabled={!e.child_count} onClick={()=>depth>=2?p.onOpen(e):toggle(e)}>{e.child_count?(expanded.has(e.id)&&depth<2?<ChevronDown size={17}/>:<ChevronRight size={17}/>):<span className="j-tree-dot"/>}</button>
        {e.images.length>0&&<div className="j-tree-thumb"><JournalImage id={e.cover_attachment_id||e.images[0]}/></div>}
        <button className="j-tree-title" onClick={()=>void safeLeave().then(ok=>ok&&p.onOpen(e))}><strong>{journalTitle(e)}</strong><small>{sort==='created'?'输入 '+new Date(e.created_at).toLocaleDateString('zh-CN'):e.event_date}{e.child_count?` · ${e.child_count} 条细节`:''}</small>{expenseLabel(e)&&<small>{expenseLabel(e)}</small>}</button>
        {organize?<button className="j-drag-handle" aria-label={`拖动：${journalTitle(e)}`} disabled={busy||!!inline} onPointerDown={ev=>start(ev,e)}><GripVertical size={20}/></button>:<button className="j-icon" aria-label={`添加细节：${journalTitle(e)}`} onClick={()=>void add(e).catch(err=>setError(err.message))}><Plus size={17}/></button>}
        <button className="j-icon" aria-label={`事件操作：${journalTitle(e)}`} onClick={()=>setMenu(e)}><MoreHorizontal size={18}/></button>
      </div>
      {expanded.has(e.id)&&depth<2&&<>{renderChildren(e.id,depth+1)}{inlineRow(e.id)}</>}
    </React.Fragment>)}
    {page.entries.length<page.total&&<button className="j-text" onClick={()=>void load(parentId,true)}>加载更多细节（{page.entries.length}/{page.total}）</button>}
    {!page.entries.length&&parentId&&!inline&&<p className="j-muted j-tree-empty">还没有细节，点“＋细节”开始记录。</p>}
    </div>;
  };
  return <section className="j-event-tree" ref={el} aria-label="事件树">{organize&&<div className="j-tree-drop-root j-drop-sticky" data-j-drop-parent={p.root?.id||''}>拖到这里，{p.root?'移出到「'+journalTitle(p.root)+'」':'移为独立事件'}</div>}
    <div className="j-tree-toolbar"><strong>{p.root?'事件细节':'手帐事件树'}</strong><button disabled={busy||!!inline} className="j-text" onClick={()=>setOrganize(v=>!v)}>{organize?'完成整理':'整理'}</button>{p.root&&<button className="j-text" disabled={busy} onClick={()=>void add(p.root!).catch(e=>setError(e.message))}>＋细节</button>}</div>
    {p.root?.parent_id&&<button className="j-tree-path" data-j-drop-parent={p.root.parent_id} onClick={()=>void safeLeave().then(async ok=>{if(ok)p.onOpen(await journal.get(p.root!.parent_id!));}).catch(e=>setError(e.message))}><ArrowUpLeft size={16}/>返回上一级 · {p.root.path?.[p.root.path.length-1]?.title||'所属事件'}</button>}
    {error&&<div className="j-error" role="alert">{error}<button onClick={()=>setError('')}>知道了</button></div>}
    <div className="j-tree-sort"><select aria-label="事件树排序" value={sort} onChange={e=>setSort(e.target.value as JournalSort)}><option value="event">事件时间</option><option value="created">输入时间</option></select><button aria-label="切换时间排序方向" onClick={()=>setDirection(v=>v==='asc'?'desc':'asc')}>{direction==='asc'?'从早到晚 ↑':'从新到旧 ↓'}</button></div>{renderChildren(p.root?.id||null,0)}{p.root&&inlineRow(p.root.id)}
    {organize&&<><p className="j-muted">按{sort==='event'?'事件时间':'输入时间'}排列；拖动调整关系，不改写时间。</p><div className="j-tree-drop-root" data-j-drop-parent="">拖到这里，移为独立事件</div><p className="j-muted">长按把手拖动 · 菜单也可移动 · 最多 5 层</p></>}
    {floating&&<div className="j-tree-floating" style={{left:Math.min(floating.x-80,window.innerWidth-240),top:floating.y-28}}><GripVertical size={18}/><span>{journalTitle(floating.entry)}</span><small>{drop?.label||'停留在事件上放入，或拖到上方移出'}</small></div>}
    {menu&&<div className="j-modal-backdrop" onClick={()=>setMenu(null)}><section className="j-modal" role="dialog" aria-label="事件操作" onClick={e=>e.stopPropagation()}><h2>{journalTitle(menu)}</h2><button onClick={()=>void safeLeave().then(ok=>{if(ok){void add(menu).catch(err=>setError(err.message));setMenu(null);}})}>＋ 添加细节</button><button onClick={()=>void beginMove(menu).catch(e=>setError(e.message))}>移动到…</button><button onClick={()=>{p.onOpen(menu);setMenu(null);}}>查看完整事件</button><button onClick={()=>setMenu(null)}>取消</button></section></div>}
    {move&&<div className="j-modal-backdrop"><section className="j-modal j-move-modal" role="dialog" aria-label="移动事件"><header><h2>移动「{journalTitle(move)}」</h2><button className="j-icon" disabled={busy} onClick={()=>setMove(null)}><X/></button></header><p className="j-muted">同时移动 {moveCount} 条细节，保留各自日期与图片。</p>
      <select aria-label="目标手帐" value={moveBook} onChange={e=>{setMoveBook(e.target.value);setMoveParent(null);setSearch('');}}>{p.books.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <input aria-label="搜索目标事件" placeholder="搜索所属事件" value={search} onChange={e=>setSearch(e.target.value)}/>
      {moveParent&&<button onClick={()=>{setMoveParent(null);setSearch('');}}>返回手帐顶层</button>}
      <button className="j-primary" disabled={busy} onClick={()=>void doMove(move,{parent_id:moveParent?.id||null,book_id:moveBook,target_version:moveParent?.version,label:''})}>{moveParent?`移入「${journalTitle(moveParent)}」`:'移为此手帐的独立事件'}</button>
      <div className="j-move-choices">{choices.filter(e=>e.id!==move.id&&!e.path?.some(p=>p.id===move.id)).map(e=><button key={e.id} onClick={()=>{setMoveParent(e);setSearch('');}}><span>{journalTitle(e)}<small>{e.path?.map(p=>p.title).join(' / ')||'独立事件'}</small></span><ChevronRight size={17}/></button>)}
      {(choiceCursor||(!search&&choiceOffset<choiceTotal))&&<button onClick={()=>void (search?journal.list({book_id:moveBook,query:search},choiceCursor):journal.children(moveParent?.id||null,moveBook,choiceOffset)).then((r:any)=>{setChoices(old=>[...old,...r.entries]);setChoiceOffset(n=>n+r.entries.length);setChoiceCursor(r.cursor||null);}).catch(e=>setError(e.message))}>加载更多</button>}</div>
      {error&&<p className="j-error" role="alert">{error}</p>}
    </section></div>}
  </section>;
}
