const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async()=>{
 const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:4183,strictPort:true}});await server.listen();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const out=process.env.MOBILE_QA_DIR||'/tmp/todotree-journal-tree-qa';await fs.mkdir(out,{recursive:true});
 const get=id=>page.evaluate(async id=>(await import('/src/services/journal/store.ts')).journal.get(id),id);
 try {
  await page.goto('http://127.0.0.1:4183');await page.locator('.mobile-navigation').waitFor();
  // Seed a real old browser schema before its first v2 open; migration is exercised.
  const ids=await page.evaluate(async()=>{
    const {newJournal,journalToday}=await import('/src/services/journal/model.ts');const root=newJournal(journalToday()).entry;root.title='青云市集散步';root.id='review-root';root.version=1;delete root.parent_id;delete root.sort_order;delete root.deletion_batch_id;
    await new Promise((resolve,reject)=>{const r=indexedDB.open('todotree-journal-v1',1);r.onupgradeneeded=()=>{for(const name of ['entries','drafts','books','images','operations'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['entries','books'],'readwrite');tx.objectStore('entries').put(root);tx.objectStore('books').put({id:'daily',name:'日常',created_at:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});
    return {root:root.id};
  });
  await page.getByRole('navigation',{name:'应用模式'}).getByRole('button',{name:'手帐',exact:true}).click();await page.locator('.j-shell').waitFor();
  assert.equal((await get(ids.root)).parent_id,null);
  await page.getByRole('button',{name:'事件树',exact:true}).click();await page.locator('[data-j-node="review-root"]').waitFor();
  await page.getByRole('button',{name:'添加细节：青云市集散步',exact:true}).click();await page.getByLabel('新细节',{exact:true}).fill('江湖烤鸡');await page.getByLabel('新细节',{exact:true}).press('Enter');
  await page.getByRole('button',{name:'添加细节：江湖烤鸡',exact:true}).waitFor();
  await page.getByRole('button',{name:'添加细节：江湖烤鸡',exact:true}).click();await page.getByLabel('新细节',{exact:true}).fill('推荐口味');await page.getByLabel('新细节',{exact:true}).press('Enter');await page.getByRole('button',{name:'添加细节：推荐口味',exact:true}).waitFor();
  assert.equal(await page.locator('.j-event-tree input[type="checkbox"]').count(),0);
  await page.screenshot({path:out+'/tree-first-child.png'});
  // Saving a draft before a mode switch preserves input even inside an inline tree.
  await page.getByRole('button',{name:'添加细节：青云市集散步',exact:true}).click();await page.getByLabel('新细节',{exact:true}).fill('稍后再写的细节');
  await page.locator('.j-shell').getByRole('button',{name:'待办',exact:true}).click();await page.locator('.j-shell').waitFor({state:'hidden'});
  await page.getByRole('navigation',{name:'应用模式'}).getByRole('button',{name:'手帐',exact:true}).click();await page.locator('.j-event-tree').waitFor();
  assert.ok(await page.evaluate(async()=>(await (await import('/src/services/journal/store.ts')).journal.boot()).drafts.some(d=>d.entry.title==='稍后再写的细节')));
  const seed=await page.evaluate(async()=>{
    const {journal}=await import('/src/services/journal/store.ts'),{newJournal,journalToday}=await import('/src/services/journal/model.ts'),{importWebImage}=await import('/src/services/journal/web.ts');
    const d=newJournal(journalToday());d.entry.id='review-shop';d.entry.title='街边小店';await journal.mutate('publish',{entry:d.entry,expected_version:0,draft_id:d.id});
    const images=[];for(const color of ['#78a084','#b78963','#7d93a4']){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,320,240);const blob=await new Promise(r=>canvas.toBlob(r));images.push((await importWebImage(new File([blob],color+'.png',{type:'image/png'}))).id);}
    const root=await journal.get('review-root');await journal.mutate('publish',{entry:{...root,images,cover_attachment_id:images[0]},expected_version:root.version,draft_id:'photos'});
    return {images};
  });
  await page.getByRole('button',{name:'时间线',exact:true}).click();await page.locator('[data-j-card="review-root"] .j-carousel img').first().waitFor();
  const card=page.locator('[data-j-card="review-root"]');
  await card.locator('.j-photo-rail').evaluate(e=>{e.scrollLeft=e.clientWidth;});
  await page.waitForFunction(()=>document.querySelector('[data-j-card="review-root"] .j-photo-counter')?.textContent==='2 / 3');
  assert.equal((await get('review-root')).cover_attachment_id,seed.images[0]);
  await card.getByRole('button',{name:'查看第 2 张照片',exact:true}).click();await page.locator('.j-viewer').waitFor();assert.ok((await page.locator('.j-viewer header').innerText()).includes('2 / 3'));
  await page.getByRole('button',{name:'设为封面',exact:true}).click();await page.getByRole('button',{name:'当前封面',exact:true}).waitFor();assert.equal((await get('review-root')).cover_attachment_id,seed.images[1]);
  await page.screenshot({path:out+'/gallery-cover.png'});await page.getByRole('button',{name:'关闭照片',exact:true}).click();
  // A real pointer gesture on the dedicated handle moves the entire nested branch.
  await page.getByRole('button',{name:'事件树',exact:true}).click();await page.getByRole('button',{name:'整理',exact:true}).click();
  const handle=page.getByRole('button',{name:'拖动：江湖烤鸡',exact:true});await handle.scrollIntoViewIfNeeded();
  const target=page.locator('[data-j-node="review-shop"]');await target.waitFor();const h=await handle.boundingBox(),t=await target.boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.waitForTimeout(360);await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:12});await page.waitForTimeout(420);await page.mouse.up();
  await page.locator('.j-toast').getByText('已移动，日期和照片保持原样').waitFor();
  const child=await page.evaluate(async()=>{const {journal}=await import('/src/services/journal/store.ts');return (await journal.children('review-shop')).entries[0];});assert.equal(child.title,'江湖烤鸡');
  await page.screenshot({path:out+'/tree-moved.png'});await page.locator('.j-toast').getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.j-toast').getByText('已撤销操作').waitFor();assert.equal((await get(child.id)).parent_id,'review-root');
  for(const width of [360,393,430]){await page.setViewportSize({width,height:852});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${out}/tree-${width}.png`});}
  await page.reload();await page.locator('.j-shell .j-event-tree').waitFor();assert.equal(await page.locator('.j-shell .app-mode-switch button[aria-pressed=true]').innerText(),'手帐');
  assert.deepEqual(errors,[]);console.log('PASS v1 migration, mode restore, first child/grandchild, draft flush, gallery/cover, handle drag/undo and mobile widths');
 } finally {await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
