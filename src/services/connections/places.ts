import { isAndroid } from '../native/platform';
import { loadConnections, NativeConnections } from './store';
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
  provider_snapshot?:{name:string;address:string;city:string};
}
export function parsePlaces(data:any):PlaceReference[] {
  if(String(data.status)!=='1')throw Error('高德搜索未成功，请检查 Key 的搜索权限与额度；仍可手写地点');
  if(!Array.isArray(data.pois))return [];
  return data.pois.filter((p:any)=>typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim()).slice(0,20).map((p:any)=>{
    const coordinates=typeof p.location==='string'?p.location.split(',').map(Number):[];
    const location=coordinates.length===2&&coordinates.every(Number.isFinite)&&Math.abs(coordinates[0])<=180&&Math.abs(coordinates[1])<=90?{longitude:coordinates[0],latitude:coordinates[1]}:null;
    return {provider:'amap',source_id:p.id,name:p.name.slice(0,200),address:typeof p.address==='string'?p.address.slice(0,500):'',city:typeof p.cityname==='string'?p.cityname:'',location,coordinate_system:location?'GCJ-02':null,source_url:`https://www.amap.com/place/${encodeURIComponent(p.id)}`,confirmed_at:'',provider_snapshot:{name:p.name.slice(0,200),address:typeof p.address==='string'?p.address.slice(0,500):'',city:typeof p.cityname==='string'?p.cityname:''}};
  });
}
export async function searchPlaces(query:string,city:string,signal:AbortSignal,options:{page?:number;near?:{longitude:number;latitude:number}}={}) {
  const value=query.trim();if((!value&&!options.near)||value.length>80)throw Error('填写 1–80 字的店名或地点');
  const page=options.page||1;if(!Number.isInteger(page)||page<1||page>100)throw Error('地点分页超出范围');
  const state=await loadConnections();if(!state.secrets.amap_key)throw Error('尚未设置高德 Web 服务 Key，可以先手写或粘贴分享内容');
  const url=new URL('https://restapi.amap.com/v5/place/'+(options.near?'around':'text'));
  url.searchParams.set('key',state.secrets.amap_key);url.searchParams.set('keywords',value);
  url.searchParams.set('page_size','20');url.searchParams.set('page_num',String(page));
  if(options.near){url.searchParams.set('location',options.near.longitude.toFixed(6)+','+options.near.latitude.toFixed(6));url.searchParams.set('radius','5000');url.searchParams.set('sortrule','distance');}
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

export function validatePlace(p:PlaceReference) {
  if(!p||!['amap','share','manual'].includes(p.provider)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||typeof p.address!=='string'||p.address.length>500||typeof p.city!=='string'||p.city.length>100||typeof p.confirmed_at!=='string'||!Number.isFinite(Date.parse(p.confirmed_at)))throw Error('确认地点格式无效');
  if(p.location&&(!Number.isFinite(p.location.longitude)||!Number.isFinite(p.location.latitude)||Math.abs(p.location.longitude)>180||Math.abs(p.location.latitude)>90||p.coordinate_system!=='GCJ-02'))throw Error('地点坐标无效');
  if(p.source_url!==null&&(!/^https:\/\//.test(p.source_url)||p.source_url.length>2000))throw Error('地点来源链接无效');
}
export async function locateForPlaces(signal:AbortSignal) {
  const state=await loadConnections();if(!state.secrets.amap_key)throw Error('先设置高德 Key，再搜索附近；城市搜索不需要定位');
  if(signal.aborted)throw new DOMException('已取消','AbortError');
  const raw=await new Promise<{longitude:number;latitude:number}>((resolve,reject)=>{
    const done=(action:()=>void)=>{signal.removeEventListener('abort',abort);clearTimeout(timer);action();};
    const abort=()=>{if(isAndroid())void NativeConnections.cancelLocation().catch(()=>{});done(()=>reject(new DOMException('已取消','AbortError')));};
    const timer=setTimeout(()=>{if(isAndroid())void NativeConnections.cancelLocation().catch(()=>{});done(()=>reject(Error('定位超时，仍可填写城市搜索')));},10000);
    signal.addEventListener('abort',abort,{once:true});
    const success=(value:{longitude:number;latitude:number})=>done(()=>resolve(value));
    const fail=()=>done(()=>reject(Error('位置未授权或暂不可用，仍可填写城市搜索')));
    if(isAndroid())void NativeConnections.locate().then(success,fail);
    else if(navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>success(p.coords),fail,{timeout:8000,maximumAge:0,enableHighAccuracy:false});else fail();
  });
  if(signal.aborted)throw new DOMException('已取消','AbortError');
  const url=new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');url.searchParams.set('key',state.secrets.amap_key);url.searchParams.set('locations',raw.longitude+','+raw.latitude);url.searchParams.set('coordsys','gps');
  const reply=await providerRequest(url.toString(),signal);const values=String(reply.locations||'').split(',').map(Number);
  if(String(reply.status)!=='1'||values.length!==2||values.some(v=>!Number.isFinite(v))||Math.abs(values[0])>180||Math.abs(values[1])>90)throw Error('位置转换未成功，可填写城市搜索');
  return {longitude:values[0],latitude:values[1]};
}
