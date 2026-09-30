import { apiFetch } from '../native/platform';

export class ProviderError extends Error {
  constructor(message: string, public uncertain=false, public retry_after=0) { super(message); }
}
/** A single bounded request; neither search nor a failed provider starts an AI/retry loop. */
export async function providerRequest(url: string, signal: AbortSignal, init: RequestInit = {}) {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal.aborted)throw new DOMException('已取消','AbortError');
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,12000);
  try {
    const response=await apiFetch(url,{...init,signal:controller.signal,responseLimit:2_000_000,timeoutMs:12000});
    if(response.status===429){const retry=Number(response.headers.get('Retry-After')||60);throw new ProviderError('来源暂时限流，请稍后再查；可以继续手动记录',false,Number.isFinite(retry)&&retry>0?Math.min(retry,3600):60);}
    if(!response.ok)throw new ProviderError(response.status===401||response.status===403?'来源凭证或服务权限不可用，请检查连接设置':'来源暂不可用，可继续手动记录');
    if(Number(response.headers.get('Content-Length')||0)>2_000_000)throw new ProviderError('来源响应过大，已停止读取');
    let text='';
    if(response.body){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>2_000_000){await reader.cancel();throw new ProviderError('来源响应过大，已停止读取');}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}else text=await response.text();
    if(text.length>2_000_000)throw new ProviderError('来源响应过大，已停止读取');
    try{return JSON.parse(text);}catch{throw new ProviderError('来源返回了无法识别的数据');}
  } catch(e) {
    if(signal.aborted)throw new DOMException('已取消','AbortError');
    if(controller.signal.aborted)throw new ProviderError('查询超时，可继续手动记录');
    if(e instanceof ProviderError)throw e;
    throw new ProviderError("来源网络暂不可用，可继续手动记录");
  } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
