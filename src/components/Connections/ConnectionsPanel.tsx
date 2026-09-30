import React,{useEffect,useRef,useState} from 'react';
import { loadConnections,saveConnections,ConnectionSnapshot,NativeConnections,connectionBackup,restoreConnectionBackup,invalidateConnections } from '../../services/connections/store';
import { NativeWorkspace } from '../../services/native/platform';
import { readBackupFile } from '../../services/backupCodec';
import { isAndroid } from '../../services/native/platform';
import { sendFeishu,validFeishuWebhook } from '../../services/connections/sharing';
import { downloadJsonFile } from '../../services/importExport';
import './connections.css';

export function ConnectionsPanel(){
 const [value,setValue]=useState<ConnectionSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState<{granted:boolean;exact:boolean;task_channel:boolean}|null>(null);
 const file=useRef<HTMLInputElement>(null);
 const lock=useRef(false),request=useRef<AbortController|null>(null);
 useEffect(()=>{loadConnections().then(setValue).catch(e=>setError(e.message));if(isAndroid())NativeConnections.notificationStatus().then(setStatus).catch(e=>setError(e.message));return()=>request.current?.abort();},[]);
 const setting=(name:string,v:unknown)=>setValue(old=>old?{...old,settings:{...old.settings,[name]:v}}:old);
 const secret=(name:string,v:string)=>setValue(old=>old?{...old,secrets:{...old.secrets,[name]:v},settings:{...old.settings,feishu_verified:name.startsWith('feishu')?false:old.settings.feishu_verified,feishu_enabled:name.startsWith('feishu')?false:old.settings.feishu_enabled}}:old);
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}};
 const save=()=>run(async()=>{if(!value)return;if(value.secrets.feishu_webhook&&!validFeishuWebhook(value.secrets.feishu_webhook))throw Error('填写有效的飞书自定义机器人 HTTPS 地址');setValue(await saveConnections(value));setNotice('连接配置已保存；保存不会发送消息');});
 const test=()=>run(async()=>{if(!value)return;const controller=new AbortController();request.current=controller;await sendFeishu(value,'TodoTree 连接测试：请确认这是您选择的提醒目的地。',controller.signal);const updated={...value,settings:{...value.settings,feishu_verified:true}};setValue(await saveConnections(updated));setNotice('飞书接口已接受测试消息，请到目的地核对；确认后可开启渠道');});
 if(!value)return <div className="connection-body">{error?<><p className="connection-error">{error}</p>{isAndroid()&&<button disabled={busy} onClick={()=>void run(async()=>{if(!confirm('重置高德、USDA 与飞书的连接凭证？个人营养标签和任务保留，之后需要重新填写 Key。'))return;setValue(await NativeConnections.resetCredentials());invalidateConnections();setNotice('连接凭证已重置，请重新填写');})}>重置连接凭证</button>}</>:'读取连接配置…'}</div>;
 return <div className="connection-body"><fieldset disabled={busy}>
 <section><h3>地点与食品来源</h3><label>默认搜索城市<input aria-label="默认搜索城市" value={value.settings.city} maxLength={100} placeholder="如：贵阳" onChange={e=>setting('city',e.target.value)}/></label>
 <label>高德 Web 服务 Key<input aria-label="高德Key" type="password" autoComplete="off" value={value.secrets.amap_key} onChange={e=>secret('amap_key',e.target.value)}/></label><p className="connection-hint">需要该 Key 具备地点搜索权限；未配置时仍可手写或保存分享链接。</p>
 <label>USDA 正式 Key<input aria-label="USDAKey" type="password" autoComplete="off" value={value.secrets.usda_key} onChange={e=>secret('usda_key',e.target.value)}/></label>
 <label className="connection-check"><input type="checkbox" checked={value.settings.off_enabled} onChange={e=>setting('off_enabled',e.target.checked)}/>启用 Open Food Facts 包装食品条码查询</label><p className="connection-hint">USDA 未配置时只保留演示查询；包装数据为众包，请核对单位与包装。个人标签只保存在本机。</p>
 <a className="connection-hint" href="https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/" target="_blank" rel="noreferrer">Open Food Facts 数据来源与许可 ↗</a></section>
 <section><h3>办公提醒 · 飞书群机器人</h3><label>目的地名称<input aria-label="飞书目的地" placeholder="自己命名，例如项目群" maxLength={100} value={value.settings.feishu_label} onChange={e=>setting('feishu_label',e.target.value)}/></label>
 <label>机器人 Webhook<input aria-label="飞书Webhook" type="password" autoComplete="off" value={value.secrets.feishu_webhook} onChange={e=>secret('feishu_webhook',e.target.value)}/></label><label>签名 Secret（选填）<input aria-label="飞书签名Secret" type="password" autoComplete="off" value={value.secrets.feishu_secret} onChange={e=>secret('feishu_secret',e.target.value)}/></label>
 <p className="connection-hint">测试内容：TodoTree 连接测试，请确认这是您选择的提醒目的地。只发送这句测试文字。</p><button onClick={()=>void test()} disabled={!value.settings.feishu_label.trim()||!validFeishuWebhook(value.secrets.feishu_webhook)}>向「{value.settings.feishu_label||'未指定目的地'}」发送测试</button>
 <label className="connection-check"><input type="checkbox" disabled={!value.settings.feishu_verified} checked={value.settings.feishu_enabled} onChange={e=>setting('feishu_enabled',e.target.checked)}/>已核对目的地，启用此渠道</label><p className="connection-hint">自动推送由本机执行，断网、关机或后台限制可能影响发送；不会上传手帐或健康记录。系统分享无需机器人配置。</p></section>
 <section><h3>本机通知与准时提醒</h3>{isAndroid()?<><p className="connection-hint">通知：{status?.granted&&status.task_channel?'已开启':'未开启'} · 准时权限：{status?.exact?'已开启':'未开启，可能延迟'}</p><div className="place-actions"><button onClick={()=>void run(async()=>{setStatus(await NativeConnections.requestNotifications());})}>开启通知</button><button onClick={()=>void run(async()=>{await NativeConnections.exactSettings();})}>准时提醒设置</button><button onClick={()=>void run(async()=>{await NativeConnections.testNotification();setNotice('测试通知已提交，请在通知栏核对');})}>测试本机通知</button><button onClick={()=>void run(async()=>{setStatus(await NativeConnections.notificationStatus());})}>重新检查</button></div></>:<p className="connection-hint">网页可以保存提醒时间；原生锁屏通知需要 Android 安装版。日历文件与系统分享仍可使用。</p>}</section>
 <input ref={file} type="file" accept="application/json,.json" hidden onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void run(async()=>{const result=JSON.parse(await readBackupFile(selected));if(!confirm('恢复个人营养标签和非敏感连接配置？凭证保持不变，飞书需要重新验证。'))return;setValue(await restoreConnectionBackup(result));setNotice('个人标签与配置已恢复，凭证未从备份导入');});}}/>
 <p className="connection-hint">{isAndroid()?'凭证在本机加密保存，不进入普通备份。':'网页凭证只保存当前标签页会话，关闭后需重新填写。'}</p><div className="place-actions"><button className="connection-primary" onClick={()=>void save()}>{busy?'处理中…':'保存连接配置'}</button><button onClick={()=>void run(async()=>{await downloadJsonFile(JSON.stringify(connectionBackup(value),null,2),'TodoTree-Connections.json');setNotice('已发起不含凭证的连接配置与个人标签备份');})}>导出个人标签与配置</button><button onClick={()=>{if(isAndroid())void run(async()=>{const selected=await NativeWorkspace.importFile();if(selected.cancelled)return;if(!confirm('恢复个人标签和非敏感配置？飞书需要重新验证。'))return;setValue(await restoreConnectionBackup(JSON.parse(selected.content||'')));setNotice('个人标签与配置已恢复');});else file.current?.click();}}>恢复个人标签与配置</button></div>
 </fieldset>{error&&<p className="connection-error" role="alert">{error}</p>}{notice&&<p className="connection-notice" role="status">{notice}</p>}</div>;
}
export function ConnectionsDialog({onClose}:{onClose:()=>void}){
 useEffect(()=>{const back=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();onClose();};window.addEventListener('todotree:back',back,true);return()=>window.removeEventListener('todotree:back',back,true);},[onClose]);
 return <div className="connection-overlay"><section className="connection-dialog" role="dialog" aria-modal="true" aria-label="连接与提醒"><header><h2>连接与提醒</h2><button aria-label="关闭连接设置" onClick={onClose}>关闭</button></header><ConnectionsPanel/></section></div>;
}
