import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHmac,createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const dir=path.resolve('node_modules/.cache/connection-tests');await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'entry.ts'),['health/food','connections/places','connections/sharing','connections/store','connections/reminders','taskLifecycle','navigationGuard'].map(p=>`export * from ${JSON.stringify(path.resolve('src/services',p))};`).join('\n'));
await build({entryPoints:[path.join(dir,'entry.ts')],outfile:path.join(dir,'connections.cjs'),bundle:true,format:'cjs',platform:'node',logLevel:'silent'});
const require=createRequire(import.meta.url),api=require(path.join(dir,'connections.cjs'));
const food=p=>api.parsePackagedFood({code:'6901234567890',product:{code:'6901234567890',product_name:'包装食品',...p}})[0];
test('packaged gram, millilitre and unknown labels never invent density or count unknown as zero',()=>{
 assert.equal(food({product_quantity_unit:'g',nutriments:{'energy-kcal_100g':123}}).kcal_per_100g,123);
 assert.equal(food({product_quantity_unit:'g',nutriments:{'energy-kcal_100g':0}}).kcal_per_100g,0);
 const liquid=food({product_quantity_unit:'ml',nutriments:{'energy-kcal_100g':46}});assert.equal(liquid.kcal_per_100g,null);assert.equal(liquid.label_energy.basis,'100ml');assert.match(api.nutritionLabel(liquid),/不可直接/);
 assert.equal(food({nutriments:{'energy-kcal_100g':46}}).kcal_per_100g,null);
 assert.equal(food({product_quantity_unit:'g',nutriments:{'energy-kj_100g':418.4}}).kcal_per_100g,100);
 assert.equal(food({product_quantity_unit:'g',nutriments:{'energy-kcal_100g':-1}}).kcal_per_100g,null);
 assert.deepEqual(api.parsePackagedFood({product:{code:'bad',product_name:'unknown'}}),[]);
});
test('nutrition snapshots and personal-label backup preserve provenance, zero and unknown without credentials',()=>{
 const state=api.defaultConnections();state.secrets.amap_key='not-a-live-map-key';state.secrets.feishu_secret='not-a-live-secret';state.settings.feishu_verified=true;state.settings.feishu_enabled=true;state.settings.foods=[food({product_quantity_unit:'g',nutriments:{'energy-kcal_100g':0}})];
 const backup=api.connectionBackup(state);assert.equal(backup.settings.foods[0].source,'Open Food Facts（众包）');assert.equal(backup.settings.feishu_enabled,false);assert.ok(!JSON.stringify(backup).includes('not-a-live'));backup.settings.foods[0].name='改动';assert.equal(state.settings.foods[0].name,'包装食品');
 assert.throws(()=>api.validateConnections({...state,settings:{...state.settings,foods:[{...state.settings.foods[0],kcal_per_100g:NaN}]}}));
});
test('place results retain separate branches, GCJ-02 coordinates and user confirmation is still required',()=>{
 const rows=api.parsePlaces({status:'1',pois:[{id:'a',name:'店 A',address:'南街',cityname:'贵阳',location:'106.6,26.6'},{id:'b',name:'店 A',address:'北街',location:'bad'}]});assert.equal(rows.length,2);assert.notEqual(rows[0].source_id,rows[1].source_id);assert.deepEqual(rows[0].location,{longitude:106.6,latitude:26.6});assert.equal(rows[0].coordinate_system,'GCJ-02');assert.equal(rows[0].confirmed_at,'');assert.equal(rows[1].location,null);assert.throws(()=>api.parsePlaces({status:0}));
});
test('share parsing keeps only allowed public HTTPS links and never fetches an arbitrary URL',()=>{
 assert.equal(api.parsePlaceShare('餐厅 https://m.dianping.com/shop/42').source_url,'https://m.dianping.com/shop/42');
 for(const url of ['https://127.0.0.1/','https://dianping.com.evil.test/shop/1','http://amap.com/','https://user:password@amap.com/','https://169.254.169.254/'])assert.equal(api.parsePlaceShare('地点 '+url).source_url,null);
 assert.equal(api.parsePlaceShare('手写地点').provider,'manual');assert.throws(()=>api.parsePlaceShare(''));
});
test('Feishu signing matches an independent HMAC implementation and redirect/lookalike endpoints are rejected',async()=>{
 const ts='1700000000',secret='fixture-secret';assert.equal(await api.feishuSignature(secret,ts),createHmac('sha256',ts+'\n'+secret).update('').digest('base64'));
 assert.equal(api.validFeishuWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345'),true);
 for(const url of ['http://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345','https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/fixture-12345','https://user:password@open.feishu.cn/open-apis/bot/v2/hook/fixture-12345','https://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345?key=1'])assert.equal(api.validFeishuWebhook(url),false);
});
const rule=()=>({enabled:true,trigger_at:new Date(Date.now()+60_000).toISOString(),timezone:'Asia/Shanghai',revision:'version-1',exact:true,channels:['local'],hide_title:true});
const task=(id,parent_id=null)=>({id,parent_id,title:id,status:'open',completed_at:null,archived_at:null,deleted_at:null,reminder:rule()});
test('reminder eligibility stops on completion, deletion, archive, pause and past time',()=>{
 const t=task('a');assert.equal(api.reminderEligible(t),true);for(const patch of [{status:'done'},{deleted_at:'now'},{archived_at:'now'},{reminder:{...rule(),enabled:false}},{reminder:{...rule(),trigger_at:'2020-01-01T00:00:00Z'}}])assert.equal(api.reminderEligible({...t,...patch}),false);
 for(const patch of [{channels:['other']},{channels:['local','local']},{timezone:'not-zone'},{trigger_at:'invalid'}])assert.throws(()=>api.validateReminder({...rule(),...patch}));
});
test('partial child completion preserves sibling reminders; final closure makes the full branch ineligible',()=>{
 const initial=[task('parent'),task('one','parent'),task('two','parent')];const first=api.completeTaskBranch(initial,'one').tasks;assert.equal(api.reminderEligible(first.find(t=>t.id==='parent')),true);assert.equal(api.reminderEligible(first.find(t=>t.id==='two')),true);assert.equal(api.reminderEligible(first.find(t=>t.id==='one')),false);const final=api.completeTaskBranch(first,'two').tasks;assert.ok(final.every(t=>!api.reminderEligible(t)));
});
test('import pauses reminders with a fresh revision while retaining task and historical timestamps',()=>{
 const original=[task('a')],copy=api.pauseImportedReminders(original);assert.equal(original[0].reminder.enabled,true);assert.equal(copy[0].reminder.enabled,false);assert.notEqual(copy[0].reminder.revision,original[0].reminder.revision);assert.equal(copy[0].reminder.trigger_at,original[0].reminder.trigger_at);assert.equal(copy[0].id,original[0].id);
});
test('scheduled Feishu reminders bind to the verified destination instead of following later configuration edits',async()=>{
 const state=api.defaultConnections();state.secrets.feishu_webhook='https://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345';
 const hash=await api.feishuDestination(state);assert.equal(hash,createHash('sha256').update(state.secrets.feishu_webhook).digest('hex'));
 assert.doesNotThrow(()=>api.validateReminder({...rule(),channels:['feishu'],feishu_destination:hash}));
 assert.throws(()=>api.validateReminder({...rule(),channels:['feishu']}));
 state.secrets.feishu_webhook='https://open.feishu.cn/open-apis/bot/v2/hook/fixture-67890';assert.notEqual(await api.feishuDestination(state),hash);
 assert.throws(()=>api.validateReminder({...rule(),trigger_at:'2099-01-01T12:00:00'}),'ambiguous timestamps must not enter native alarms');
});
test('notification navigation waits for every draft, rejects failed saves and honors a busy editor',async()=>{
 const dom=new JSDOM('',{url:'https://localhost/'}),oldWindow=globalThis.window,oldEvent=globalThis.CustomEvent;
 globalThis.window=dom.window;globalThis.CustomEvent=dom.window.CustomEvent;
 let release,stored=false;
 const off=api.registerNavigationGuard(()=>new Promise(resolve=>{release=()=>{stored=true;resolve();};}));
 try{
  const next=api.prepareNavigation();await Promise.resolve();assert.equal(stored,false);assert.equal(await api.prepareNavigation(),false,'concurrent navigation cannot bypass the saving editor');release();assert.equal(await next,true);assert.equal(stored,true);off();
  const busy=api.registerNavigationGuard(()=>false);assert.equal(await api.prepareNavigation(),false);busy();
  const fail=api.registerNavigationGuard(()=>Promise.reject(Error('disk full')));await assert.rejects(api.prepareNavigation(),/disk full/);fail();assert.equal(await api.prepareNavigation(),true);
 }finally{off();dom.window.close();globalThis.window=oldWindow;globalThis.CustomEvent=oldEvent;}
});
