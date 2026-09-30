import React,{useEffect,useRef,useState} from 'react';
import { PlaceReference,parsePlaceShare,searchPlaces } from '../../services/connections/places';
import { loadConnections } from '../../services/connections/store';
import { ConnectionsDialog } from './ConnectionsPanel';
import './connections.css';

export function PlacePicker(p:{initial?:PlaceReference|null;onChoose:(place:PlaceReference)=>void;onClose:()=>void}){
 const [query,setQuery]=useState(p.initial?.name||''),[city,setCity]=useState(p.initial?.city||''),[share,setShare]=useState(''),[results,setResults]=useState<PlaceReference[]>([]),[selected,setSelected]=useState<PlaceReference|null>(p.initial||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(false);
 const request=useRef<AbortController|null>(null),lock=useRef(false);
 useEffect(()=>{loadConnections().then(s=>{if(!p.initial?.city)setCity(s.settings.city);}).catch(e=>setError(e.message));return()=>request.current?.abort();},[]);
 useEffect(()=>{const back=(e:Event)=>{if(document.querySelector('.connection-overlay'))return;e.preventDefault();e.stopImmediatePropagation();p.onClose();};window.addEventListener('todotree:back',back,true);return()=>window.removeEventListener('todotree:back',back,true);},[p.onClose]);
 const search=async()=>{if(lock.current)return;lock.current=true;request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError('');try{const found=await searchPlaces(query,city,c.signal);if(!c.signal.aborted){setResults(found);if(!found.length)setError('没有匹配地点，可以手写或粘贴分享内容');}}catch(e){if(!c.signal.aborted)setError((e as Error).message);}finally{lock.current=false;setBusy(false);}};
 return <div className="place-overlay"><section className="place-dialog" role="dialog" aria-modal="true" aria-label="选择地点"><header><h2>选择地点</h2><button onClick={p.onClose}>返回</button></header><div className="place-body">
 <label>城市<input aria-label="地点搜索城市" value={city} onChange={e=>{request.current?.abort();setCity(e.target.value);setResults([]);}} maxLength={100} placeholder="不定位也能搜，填写城市更准确"/></label><label>店名 / 地点<input aria-label="地点搜索关键词" value={query} onChange={e=>{request.current?.abort();setQuery(e.target.value);setResults([]);}} maxLength={100}/></label>
 <div className="place-actions"><button className="connection-primary" disabled={busy||!query.trim()} onClick={()=>void search()}>{busy?'查询中…':'查询门店'}</button><button onClick={()=>{if(query.trim())setSelected({...parsePlaceShare(query),city});}}>使用手写地点</button><button onClick={()=>setSettings(true)}>来源设置</button></div>
 <p className="connection-hint">核对同名分店和地址；选择门店不会自动记录消费或发布事件。</p>
 {error&&<p className="connection-error" role="alert">{error}</p>}{results.map((r,i)=><button className="place-result" key={r.source_id||i} aria-pressed={selected?.source_id===r.source_id} onClick={()=>setSelected(r)}><strong>{r.name}</strong><small>{r.city} · {r.address||'地址未提供'}</small><small>高德地点信息</small></button>)}
 <label>粘贴高德 / 美团 / 口碑分享内容<textarea aria-label="地点分享内容" value={share} maxLength={8000} onChange={e=>setShare(e.target.value)} placeholder="不解析私有订单，也不会访问分享链接"/></label><button disabled={!share.trim()} onClick={()=>{try{setSelected(parsePlaceShare(share));setError('');}catch(e){setError((e as Error).message);}}}>预览分享地点</button>
 {selected&&<div className="place-confirm"><label>确认名称<input aria-label="确认地点名称" value={selected.name} maxLength={200} onChange={e=>setSelected({...selected,name:e.target.value})}/></label><p>{selected.city} {selected.address}</p><p className="connection-hint">{selected.provider==='amap'?'高德候选；已保留来源与坐标系':selected.source_url?'用户分享链接；地址与门店仍由你核对':'用户手写地点'}</p><button className="connection-primary" disabled={!selected.name.trim()} onClick={()=>p.onChoose({...selected,name:selected.name.trim(),confirmed_at:new Date().toISOString()})}>确认使用这个地点</button></div>}
 </div></section>{settings&&<ConnectionsDialog onClose={()=>setSettings(false)}/>}</div>;
}
