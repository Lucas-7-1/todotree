import React,{useEffect,useRef,useState} from 'react';
import { PlaceReference,parsePlaceShare,searchPlaces,locateForPlaces } from '../../services/connections/places';
import { loadConnections,rememberPlace } from '../../services/connections/store';
import { ConnectionsDialog } from './ConnectionsPanel';
import './connections.css';

export function PlacePicker(p:{initial?:PlaceReference|null;onChoose:(place:PlaceReference)=>void;onClose:()=>void}){
 const [query,setQuery]=useState(p.initial?.name||''),[city,setCity]=useState(p.initial?.city||''),[share,setShare]=useState(''),[results,setResults]=useState<PlaceReference[]>([]),[recent,setRecent]=useState<PlaceReference[]>([]),[selected,setSelected]=useState<PlaceReference|null>(p.initial||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(false),[page,setPage]=useState(1),[more,setMore]=useState(false);
 const request=useRef<AbortController|null>(null),near=useRef<{longitude:number;latitude:number}|undefined>(),alive=useRef(true);
 useEffect(()=>{alive.current=true;loadConnections().then(s=>{if(alive.current){if(!p.initial?.city)setCity(s.settings.city);setRecent(s.settings.recent_places||[]);}}).catch(e=>alive.current&&setError(e.message));return()=>{alive.current=false;request.current?.abort();};},[]);
 useEffect(()=>{const back=(e:Event)=>{if(document.querySelector('.connection-overlay'))return;e.preventDefault();e.stopImmediatePropagation();p.onClose();};window.addEventListener('todotree:back',back,true);return()=>window.removeEventListener('todotree:back',back,true);},[p.onClose]);
 const clear=()=>{request.current?.abort();setBusy(false);setResults([]);setMore(false);setPage(1);near.current=undefined;};
 const search=async(next=1,nearby=false)=>{
  request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError('');
  try {
   if(nearby)near.current=await locateForPlaces(c.signal);else if(next===1)near.current=undefined;
   const found=await searchPlaces(query,city,c.signal,{page:next,near:near.current});
   if(request.current===c&&!c.signal.aborted){setResults(found);setPage(next);setMore(found.length===20&&next<100);if(!found.length)setError('没有匹配地点，可以手写或粘贴分享内容');}
  }catch(e){if(request.current===c&&!c.signal.aborted)setError((e as Error).message);}finally{if(request.current===c&&alive.current)setBusy(false);}
 };
 const confirm=async()=>{if(!selected||busy)return;const place={...selected,name:selected.name.trim(),confirmed_at:new Date().toISOString()};setBusy(true);try{await rememberPlace(place);}catch{setError('地点可使用，最近地点未能保存');}finally{if(alive.current){setBusy(false);p.onChoose(place);}}};
 return <div className="place-overlay"><section className="place-dialog" role="dialog" aria-modal="true" aria-label="选择地点"><header><h2>选择地点</h2><button onClick={p.onClose}>返回</button></header><div className="place-body">
 {!!recent.length&&<details><summary>最近使用的地点</summary>{recent.map((r,i)=><button className="place-result" key={i} onClick={()=>setSelected(structuredClone(r))}><strong>{r.name}</strong><small>{r.city} · {r.address||'地址未填'}</small></button>)}</details>}
 <label>城市<input aria-label="地点搜索城市" value={city} onChange={e=>{clear();setCity(e.target.value);}} maxLength={100} placeholder="不定位也能搜，填写城市更准确"/></label><label>店名 / 地点<input aria-label="地点搜索关键词" value={query} onChange={e=>{clear();setQuery(e.target.value);}} maxLength={80}/></label>
 <div className="place-actions"><button className="connection-primary" disabled={busy||!query.trim()} onClick={()=>void search()}>{busy?'查询中…':'查询门店'}</button><button disabled={busy} onClick={()=>void search(1,true)}>搜索附近 · 需要定位</button><button onClick={()=>{if(query.trim())setSelected({...parsePlaceShare(query),city});}}>使用手写地点</button><button onClick={()=>setSettings(true)}>来源设置</button></div>
 <p className="connection-hint">城市搜索不需要位置权限。附近搜索临时使用位置，不保存你的当前位置；请核对分店和地址。</p>
 {error&&<p className="connection-error" role="alert">{error}</p>}{results.map((r,i)=><button className="place-result" key={r.source_id||i} aria-pressed={selected?.source_id===r.source_id} onClick={()=>setSelected(r)}><strong>{r.name}</strong><small>{r.city} · {r.address||'地址未提供'}</small><small>高德地点信息</small></button>)}
 {!!results.length&&<div className="place-actions"><span>第 {page} 页 · 每页最多 20 个候选</span>{page>1&&<button disabled={busy} onClick={()=>void search(page-1)}>上一页</button>}{more&&<button disabled={busy} onClick={()=>void search(page+1)}>下一页</button>}</div>}
 <label>粘贴高德 / 美团 / 口碑分享内容<textarea aria-label="地点分享内容" value={share} maxLength={8000} onChange={e=>setShare(e.target.value)} placeholder="保留公开链接；名称或地址解析失败时可手写"/></label><button disabled={!share.trim()} onClick={()=>{try{setSelected(parsePlaceShare(share));setError('');}catch(e){setError((e as Error).message);}}}>预览分享地点</button>
 {selected&&<div className="place-confirm"><label>确认名称<input aria-label="确认地点名称" value={selected.name} maxLength={200} onChange={e=>setSelected({...selected,name:e.target.value})}/></label><label>确认地址<input aria-label="确认地点地址" value={selected.address} maxLength={500} onChange={e=>setSelected({...selected,address:e.target.value})}/></label><p>{selected.city}</p><p className="connection-hint">{selected.provider==='amap'?'高德候选；保留原始来源':selected.source_url?'用户分享链接；请核对具体门店':'用户手写地点'}。确认仅填写地点，事件另行保存。</p><button className="connection-primary" disabled={busy||!selected.name.trim()} onClick={()=>void confirm()}>确认使用这个地点</button></div>}
 </div></section>{settings&&<ConnectionsDialog onClose={()=>setSettings(false)}/>}</div>;
}
