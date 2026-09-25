import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
const dir=path.resolve('node_modules/.cache/todotree-android-tests');await mkdir(dir,{recursive:true});
const mock=path.join(dir,'platform.ts');
await writeFile(mock, `export const isAndroid = () => true; export const NativeWorkspace = { read: (...a) => globalThis.nativeMock.read(...a), commit: (...a) => globalThis.nativeMock.commit(...a) }; export { workspaceDelta } from '../../../src/services/native/workspaceDelta';`);
await build({entryPoints:['src/services/durableStore.ts'],outfile:path.join(dir,'store.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'native-bridge-test',setup(b){b.onResolve({filter:/native\/platform$/},()=>({path:mock}));}}]});
await build({entryPoints:['src/services/native/workspaceDelta.ts'],outfile:path.join(dir,'delta.cjs'),bundle:true,platform:'node',format:'cjs'});
const require=createRequire(import.meta.url), {workspaceDelta}=require(path.join(dir,'delta.cjs'));
const dom=new JSDOM('',{url:'https://localhost/'});globalThis.window=dom.window;globalThis.localStorage=dom.window.localStorage;globalThis.CustomEvent=dom.window.CustomEvent;
const clone=v=>JSON.parse(JSON.stringify(v));
const task=id=>({id,title:id,parent_id:null,status:'open'});
function setup(){
 delete require.cache[path.join(dir,'store.cjs')];localStorage.clear();
 const api=require(path.join(dir,'store.cjs'));let state={schema_version:2,revision:0,operation_id:'android-init',saved_at:new Date().toISOString(),data:api.emptyWorkspace()};const writes=[];
 globalThis.fetch=()=>{throw Error('Android must not request desktop server')};
 globalThis.nativeMock={read:async()=>clone(state),commit:async op=>{if(op.operation_id===state.operation_id)return clone(state);if(op.expected_revision!==state.revision)throw Error('conflict');const next=clone(state.data);
 for(const c of op.changes){const idKey={tasks:'id',events:'event_id',reports:'id',attempts:'attempt_id'}[c.collection];next[c.collection]=next[c.collection].filter(v=>v[idKey]!==c.id);if(c.value!==null)next[c.collection].splice(c.position,0,JSON.parse(c.value));}
 next.settings=op.settings;next.ai_settings=op.ai_settings;state={...state,revision:state.revision+1,operation_id:op.operation_id,data:next};writes.push(op);return clone(state);}};
 return{api,writes,state:()=>state};
}
test('Android localhost loads native database without probing desktop server or IndexedDB',async()=>{const{api}=setup();assert.equal((await api.loadWorkspace()).revision,0);});
test('Android saves task and completion event together, never writes API key to WebView localStorage',async()=>{const{api,writes}=setup();await api.commitWorkspace(d=>({...d,tasks:[task('a')],events:[{event_id:'e',task_id:'a'}],ai_settings:{api_key:'test-not-a-secret'}}));assert.equal(writes.length,1);assert.deepEqual(writes[0].changes.map(c=>c.collection),['tasks','events']);assert.equal(localStorage.length,0);assert.ok(!(await api.exportFullBackup()).includes('test-not-a-secret'));});
test('native delta excludes unchanged 10000-event history and preserves ordering',()=>{const{api}=setup();const data=api.emptyWorkspace();data.tasks=[task('a'),task('b')];data.events=Array.from({length:10000},(_,i)=>({event_id:'e'+i}));const next=clone(data);next.tasks[1].title='changed';assert.deepEqual(workspaceDelta(data,next).map(c=>[c.collection,c.id,c.position]),[['tasks','b',1]]);next.tasks.reverse();assert.equal(workspaceDelta(data,next).length,2);});
test('Android failed write keeps recovery candidate; exact operation retry is idempotent',async()=>{const{api,writes}=setup();await api.loadWorkspace();const original=globalThis.nativeMock.commit;globalThis.nativeMock.commit=async op=>{await original(op);throw Error('lost bridge acknowledgement');};await assert.rejects(api.commitWorkspace(d=>({...d,tasks:[task('a')]})));const id=api.getRecoveryCopy().operation_id;globalThis.nativeMock.commit=original;const result=await api.retryPendingSave();assert.equal(result.operation_id,id);assert.equal(writes.length,1);assert.equal(result.data.tasks.length,1);});
test('Android backup import checkpoints atomically and retains this device API key',async()=>{const{api,writes}=setup();await api.commitWorkspace(d=>({...d,ai_settings:{api_key:'device-key'}}));const backup=await api.loadWorkspace();backup.data.tasks=[task('imported')];backup.data.ai_settings.api_key='foreign-key';await api.importFullBackup(backup);assert.equal(writes.at(-1).checkpoint,true);assert.equal((await api.loadWorkspace()).data.ai_settings.api_key,'device-key');});
test('delta rejects duplicate event IDs before crossing bridge',()=>{const{api}=setup();const empty=api.emptyWorkspace();assert.throws(()=>workspaceDelta(empty,{...empty,events:[{event_id:'e'},{event_id:'e'}]}),/数据编号/);});
