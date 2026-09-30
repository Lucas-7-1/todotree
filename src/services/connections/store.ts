import { registerPlugin } from '@capacitor/core';
import { isAndroid } from '../native/platform';
import type { FoodSnapshot } from '../health/model';

export interface ConnectionSettings {
  city:string;off_enabled:boolean;foods:FoodSnapshot[];
  feishu_label:string;feishu_verified:boolean;feishu_enabled:boolean;
}
export interface ConnectionSecrets {amap_key:string;usda_key:string;feishu_webhook:string;feishu_secret:string;}
export interface ConnectionSnapshot {revision:number;settings:ConnectionSettings;secrets:ConnectionSecrets;}
export interface NativeConnectionsAPI {
  read():Promise<ConnectionSnapshot>;save(options:ConnectionSnapshot):Promise<ConnectionSnapshot>;resetCredentials():Promise<ConnectionSnapshot>;
  share(options:{text:string;title:string}):Promise<void>;openCalendar(options:{title:string;start:number;end:number}):Promise<void>;
  takeSharedText():Promise<{text?:string;share_id?:string}>;takeTask():Promise<{task_id?:string}>;
  addListener(event:'sharedText'|'openTask',handler:(payload:any)=>void):Promise<{remove:()=>Promise<void>}>;
  notificationStatus():Promise<{granted:boolean;exact:boolean;task_channel:boolean}>;requestNotifications():Promise<{granted:boolean;exact:boolean;task_channel:boolean}>;
  exactSettings():Promise<void>;testNotification():Promise<void>;
  taskDelivery(options:{task_id:string}):Promise<{rows:{channel:string;status:string;message:string;at:number}[]}>;
}
export const NativeConnections=registerPlugin<NativeConnectionsAPI>('Connections');
const emptySecrets=():ConnectionSecrets=>({amap_key:'',usda_key:'',feishu_webhook:'',feishu_secret:''});
export const defaultConnections=():ConnectionSnapshot=>({revision:0,settings:{city:'',off_enabled:true,foods:[],feishu_label:'',feishu_verified:false,feishu_enabled:false},secrets:emptySecrets()});
const PUBLIC='todotree.connections.v1',PRIVATE=PUBLIC+'.session';
let pending:Promise<ConnectionSnapshot>|null=null;
let saveTail:Promise<unknown>=Promise.resolve();
function text(value:unknown,max:number){return typeof value==='string'&&value.length<=max;}
export function validateConnections(s:ConnectionSnapshot) {
  if(!s||!Number.isInteger(s.revision)||s.revision<0||!s.settings||!s.secrets)throw Error('连接配置损坏，未覆盖');
  const p=s.settings;
  if(!text(p.city,100)||!text(p.feishu_label,100)||typeof p.off_enabled!=='boolean'||typeof p.feishu_verified!=='boolean'||typeof p.feishu_enabled!=='boolean'||!Array.isArray(p.foods)||p.foods.length>200)throw Error('连接配置格式无效');
  for(const k of ['amap_key','usda_key','feishu_webhook','feishu_secret'] as const)if(!text(s.secrets[k],4000))throw Error('凭证格式无效');
  const ids=new Set<string>();
  for(const f of p.foods) {
    if(!f||!text(f.id,150)||!f.id||ids.has(f.id)||!text(f.name,300)||!f.name.trim()||!text(f.state,1000)||!text(f.source,300)||!text(f.data_type,200)||typeof f.captured_at!=='string'||!Number.isFinite(Date.parse(f.captured_at))||(f.kcal_per_100g!==null&&(!Number.isFinite(f.kcal_per_100g)||f.kcal_per_100g<0||f.kcal_per_100g>10000))||(f.source_url!==null&&(!text(f.source_url,2000)||!/^https?:\/\//i.test(f.source_url))))throw Error('个人营养标签格式无效');
    if(f.label_energy&&(!['100g','100ml','unknown'].includes(f.label_energy.basis)||(f.label_energy.kcal!==null&&(!Number.isFinite(f.label_energy.kcal)||f.label_energy.kcal<0))))throw Error('营养标签单位无效');
    ids.add(f.id);
  }
}
async function browserDB():Promise<IDBDatabase> {return new Promise((resolve,reject)=>{const r=indexedDB.open('TodoTreeConnections',1);r.onupgradeneeded=()=>r.result.createObjectStore('prefs');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('连接设置被其他页面占用'));});}
function legacy(){const raw=localStorage.getItem(PUBLIC);if(!raw)return null;const value=JSON.parse(raw);return value.settings?value:null;}
async function readPublic(){const db=await browserDB();try{return await new Promise<any>((resolve,reject)=>{const tx=db.transaction('prefs'),r=tx.objectStore('prefs').get('settings');tx.oncomplete=()=>{try{resolve(r.result||legacy());}catch(e){reject(e);}};tx.onerror=tx.onabort=()=>reject(tx.error||Error('读取连接配置失败'));});}finally{db.close();}}
async function writePublic(next:ConnectionSnapshot,expected:number){const db=await browserDB();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('prefs','readwrite'),store=tx.objectStore('prefs'),r=store.get('settings');let conflict=false;r.onsuccess=()=>{try{const current=r.result||legacy();if((current?.revision||0)!==expected){conflict=true;tx.abort();return;}store.put({revision:next.revision,settings:{...next.settings,feishu_verified:false,feishu_enabled:false}},'settings');}catch{tx.abort();}};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error(conflict?'另一页面已更新连接配置，请重新打开后修改':'连接配置保存失败，未确认覆盖'));});}finally{db.close();}}
export async function loadConnections():Promise<ConnectionSnapshot> {
 if(!pending)pending=(async()=>{let s:ConnectionSnapshot;
   if(isAndroid())s=await NativeConnections.read();else {s=defaultConnections();const saved=await readPublic();if(saved){s.revision=saved.revision;s.settings={...s.settings,...saved.settings,feishu_verified:false,feishu_enabled:false};}const secret=sessionStorage.getItem(PRIVATE);if(secret)s.secrets={...s.secrets,...JSON.parse(secret)};}
   validateConnections(s);return s;
 })().catch(e=>{pending=null;throw e;});
 return structuredClone(await pending);
}
async function saveNow(value:ConnectionSnapshot):Promise<ConnectionSnapshot> {
 validateConnections(value);let next:ConnectionSnapshot;
 if(isAndroid())next=await NativeConnections.save(value);else {
   next={...structuredClone(value),revision:value.revision+1};const old=sessionStorage.getItem(PRIVATE);
   sessionStorage.setItem(PRIVATE,JSON.stringify(next.secrets));
   try{await writePublic(next,value.revision);}catch(e){if(old===null)sessionStorage.removeItem(PRIVATE);else sessionStorage.setItem(PRIVATE,old);pending=null;throw e;}
   // This notice contains no settings or credentials; IndexedDB is authoritative.
   try{localStorage.setItem(PUBLIC,JSON.stringify({revision:next.revision}));}catch{}
 }
 validateConnections(next);pending=Promise.resolve(next);window.dispatchEvent(new Event('todotree:connections'));return structuredClone(next);
}
export function saveConnections(value:ConnectionSnapshot):Promise<ConnectionSnapshot>{const job=saveTail.then(()=>saveNow(value));saveTail=job.catch(()=>{});return job;}
export function invalidateConnections(){pending=null;}
if(typeof window!=='undefined')window.addEventListener('storage',e=>{if(e.key===PUBLIC){pending=null;window.dispatchEvent(new Event('todotree:connections'));}});
export async function rememberFood(food:FoodSnapshot){const s=await loadConnections();s.settings.foods=[structuredClone(food),...s.settings.foods.filter(f=>f.id!==food.id)].slice(0,200);return saveConnections(s);}
export function connectionBackup(s:ConnectionSnapshot){validateConnections(s);const p=s.settings;return {format:'todotree-connections',schema_version:1,exported_at:new Date().toISOString(),settings:{city:p.city,off_enabled:p.off_enabled,foods:structuredClone(p.foods),feishu_label:p.feishu_label,feishu_verified:false,feishu_enabled:false}};}
export async function restoreConnectionBackup(value:any){if(value?.format!=='todotree-connections'||value.schema_version!==1||!value.settings)throw Error('这不是连接配置备份，请选择对应的个人标签文件');const current=await loadConnections();const clean=connectionBackup({...current,settings:value.settings}).settings;return saveConnections({...current,settings:clean});}
