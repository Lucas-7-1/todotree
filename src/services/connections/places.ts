import { loadConnections } from './store';
import { providerRequest } from './request';

export interface PlaceReference {
  provider:'amap'|'share'|'manual';
  source_id:string|null;
  name:string;
  address:string;
  city:string;
  location:{longitude:number;latitude:number}|null;
  coordinate_system:'GCJ-02'|null;
  source_url:string|null;
  confirmed_at:string;
}
export function parsePlaces(data:any):PlaceReference[] {
  if(String(data.status)!=='1')throw Error('高德搜索未成功，请检查 Key 的搜索权限与额度；仍可手写地点');
  if(!Array.isArray(data.pois))return [];
  return data.pois.filter((p:any)=>typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim()).slice(0,20).map((p:any)=>{
    const coordinates=typeof p.location==='string'?p.location.split(',').map(Number):[];
    const location=coordinates.length===2&&coordinates.every(Number.isFinite)&&Math.abs(coordinates[0])<=180&&Math.abs(coordinates[1])<=90?{longitude:coordinates[0],latitude:coordinates[1]}:null;
    return {provider:'amap',source_id:p.id,name:p.name.slice(0,200),address:typeof p.address==='string'?p.address.slice(0,500):'',city:typeof p.cityname==='string'?p.cityname:'',location,coordinate_system:location?'GCJ-02':null,source_url:`https://www.amap.com/place/${encodeURIComponent(p.id)}`,confirmed_at:''};
  });
}
export async function searchPlaces(query:string,city:string,signal:AbortSignal) {
  const value=query.trim();if(!value||value.length>100)throw Error('填写 1–100 字的店名或地点');
  const state=await loadConnections();if(!state.secrets.amap_key)throw Error('尚未设置高德 Web 服务 Key，可以先手写或粘贴分享内容');
  const url=new URL('https://restapi.amap.com/v5/place/text');
  url.searchParams.set('key',state.secrets.amap_key);url.searchParams.set('keywords',value);
  url.searchParams.set('page_size','20');url.searchParams.set('page_num','1');
  if(city.trim()){url.searchParams.set('region',city.trim());url.searchParams.set('city_limit','true');}
  return parsePlaces(await providerRequest(url.toString(),signal));
}
export function parsePlaceShare(text:string):PlaceReference {
  const value=text.trim();if(!value||value.length>8000)throw Error('填写地点或不超过 8000 字的分享内容');
  const found=value.match(/https:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[)）。，,;；]+$/,'');
  let source_url:string|null=null;
  if(found){try{const u=new URL(found);const allowed=['amap.com','meituan.com','dianping.com','dpurl.cn','koubei.com'];if(u.protocol==='https:'&&!u.username&&!u.password&&allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))source_url=u.toString();}catch{}}
  const name=value.replace(/https?:\/\/[^\s]+/gi,'').replace(/\s+/g,' ').trim().slice(0,200);
  return {provider:source_url?'share':'manual',source_id:null,name:name||'分享的地点（请补充名称）',address:'',city:'',location:null,coordinate_system:null,source_url,confirmed_at:''};
}
