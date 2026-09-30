import { isAndroid, apiFetch } from '../native/platform';
import { NativeConnections } from './store';
import type { ConnectionSnapshot } from './store';
import type { TaskNode } from '../../types/todo';

export function validFeishuWebhook(value:string) {
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='open.feishu.cn'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]{8,200}$/.test(u.pathname);}catch{return false;}
}
export async function feishuDestination(state:ConnectionSnapshot) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state.secrets.feishu_webhook));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function feishuSignature(secret:string,timestamp:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(timestamp+'\n'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new Uint8Array()));
  return btoa(String.fromCharCode(...bytes));
}
export async function sendFeishu(state:ConnectionSnapshot,text:string,signal:AbortSignal):Promise<void> {
  if(!validFeishuWebhook(state.secrets.feishu_webhook)||!state.settings.feishu_label.trim())throw Error('填写有效的飞书机器人地址及目的地名称');
  const body:any={msg_type:'text',content:{text:text.slice(0,4000)}};
  if(state.secrets.feishu_secret){body.timestamp=String(Math.floor(Date.now()/1000));body.sign=await feishuSignature(state.secrets.feishu_secret,body.timestamp);}
  const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(abort,10000);
  let rejected=false;
  try {
    const response=await apiFetch(state.secrets.feishu_webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok){rejected=true;throw Error('飞书明确拒绝了请求，请检查机器人权限、关键词与限流状态');}
    const result=await response.json();
    if(Number(result.code??result.StatusCode)!==0){rejected=true;throw Error('机器人未接受消息，请检查安全设置与目的地');}
  } catch(e) {
    if(!rejected)throw Error('发送结果未确认，可能已经送达；请核对目的地，不会自动重发');
    throw e;
  } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export function taskShareText(task:TaskNode,path='') {
  return [task.title,path?`项目：${path}`:'',task.reminder?.trigger_at?`提醒：${new Date(task.reminder.trigger_at).toLocaleString()}`:'',task.due_date?`截止日期：${task.due_date}`:''].filter(Boolean).join('\n');
}
export async function shareTask(task:TaskNode,path:string) {
  const text=taskShareText(task,path);
  if(isAndroid()){await NativeConnections.share({text,title:'分享待办'});return '已打开系统分享页，请选择目的地';}
  if(navigator.share){await navigator.share({title:task.title,text});return '已完成系统分享操作';}
  await navigator.clipboard.writeText(text);return '已复制待办，可粘贴到办公软件';
}
export async function openTaskCalendar(task:TaskNode) {
  const at=Date.parse(task.reminder?.trigger_at||task.due_at||'');
  if(!Number.isFinite(at))throw Error('先设置一个具体提醒时刻，再创建日历事项');
  if(isAndroid()){await NativeConnections.openCalendar({title:task.title,start:at,end:at+30*60_000});return '已打开系统日历，请确认保存';}
  const stamp=(time:number)=>new Date(time).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const escape=(text:string)=>text.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,'\\$&');
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TodoTree//Personal tasks//ZH','BEGIN:VEVENT',`UID:${crypto.randomUUID()}@todotree`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(at)}`,`DTEND:${stamp(at+30*60_000)}`,`SUMMARY:${escape(task.title)}`,'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='TodoTree-Task.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return '已下载日历文件，导入后由日历应用管理';
}
