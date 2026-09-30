const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 4188, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const out = process.env.MOBILE_QA_DIR || '.cache/backup-money-qa'; await fs.mkdir(out, { recursive: true });
  const workspace = () => page.evaluate(async () => (await (await import('/src/services/durableStore.ts')).loadWorkspace()));
  try {
    await page.goto('http://127.0.0.1:4188'); await page.locator('.m-workspace').waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('todotree:global-more')));
    await page.getByRole('button', { name: '设置与备份', exact: true }).click();
    await page.getByRole('heading', { name: '设置与数据偏好' }).waitFor();
    const before = await workspace();
    const select = content => page.locator('.settings-overlay input[type=file]').setInputFiles({ name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await select(''); await page.getByText(/所选文件没有读到内容/).waitFor(); assert.deepEqual(await workspace(), before);
    await select('{"schema_version":2,'); await page.getByText(/文件内容不完整或 JSON 格式损坏/).waitFor(); assert.deepEqual(await workspace(), before);
    await select('{"format":"todotree-health","schema_version":1,"records":[]}'); await page.getByText(/这是健康备份/).waitFor(); assert.deepEqual(await workspace(), before);
    const backup = await page.evaluate(async () => (await import('/src/services/durableStore.ts')).exportFullBackup());
    const changed = JSON.parse(backup); changed.data.settings.timezone = 'Asia/Tokyo';
    await select(JSON.stringify(changed)); await page.getByText(/备份内容与校验值不一致/).waitFor(); assert.deepEqual(await workspace(), before);
    // Cancelling after a valid check must leave the current snapshot untouched.
    page.once('dialog', dialog => dialog.dismiss()); await select('\uFEFF' + backup);
    await page.getByRole('button', { name: '从 JSON 恢复', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.settings-overlay button:disabled'));
    assert.deepEqual(await workspace(), before);
    // Retry the same file; then round-trip a full backup through the real App callback.
    page.once('dialog', dialog => dialog.accept()); await select(backup);
    await page.locator('.settings-overlay').waitFor({ state: 'hidden' });
    const restored = await workspace(); assert.deepEqual(restored.data, before.data); assert.equal(restored.revision, before.revision + 1);
    const checkpoint = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('TodoTreeWorkspace', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      try { return await new Promise((resolve, reject) => { const tx = db.transaction('state'), req = tx.objectStore('state').get('restore_checkpoint'); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
    });
    assert.deepEqual(checkpoint.data, before.data);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('todotree:journal'))); await page.locator('.j-shell').waitFor();
    await page.getByRole('button', { name: '开始记录', exact: true }).click();
    await page.getByLabel('事情描述', { exact: true }).fill('消费金额布局回归');
    await page.locator('.j-editor').getByRole('button', { name: '美食', exact: true }).click();
    await page.getByLabel('消费金额', { exact: true }).fill('123456.78');
    await page.getByLabel('个人支付金额', { exact: true }).fill('88.50');
    for (const width of [320, 360, 393, 430, 768]) {
      await page.setViewportSize({ width, height: 852 });
      await page.getByLabel('消费金额', { exact: true }).scrollIntoViewIfNeeded();
      const dimensions = await page.locator('.j-money-fields').evaluate(el => ({
        boxes: [...el.querySelectorAll('input')].map(input => ({ width: input.getBoundingClientRect().width, labelWidth: input.parentElement.getBoundingClientRect().width, height: input.getBoundingClientRect().height })),
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        fieldHeight: el.getBoundingClientRect().height,
      }));
      assert.ok(dimensions.scrollWidth <= width + 1, 'no horizontal page overflow');
      for (const input of dimensions.boxes) { assert.ok(input.width >= 110, 'amount is a usable field, never a narrow pill'); assert.ok(input.width >= input.labelWidth - 1); assert.ok(input.height >= 44); }
      assert.ok(dimensions.fieldHeight < 170, 'no excessive vertical spacing');
      assert.equal(await page.getByLabel('消费金额', { exact: true }).inputValue(), '123456.78');
      await page.screenshot({ path: `${out}/expense-editor-${width}.png` });
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await page.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.j-editor').waitFor({ state: 'hidden' });
    await page.locator('.j-card-body').click(); await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByLabel('消费金额', { exact: true }).inputValue(), '123456.78');
    assert.equal(await page.getByLabel('个人支付金额', { exact: true }).inputValue(), '88.50');
    await page.getByLabel('消费金额', { exact: true }).fill('0'); await page.getByLabel('个人支付金额', { exact: true }).fill('');
    await page.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.j-editor').waitFor({ state: 'hidden' });
    await page.locator('.j-card-body').click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByLabel('消费金额', { exact: true }).inputValue(), '0.00');
    assert.equal(await page.getByLabel('个人支付金额', { exact: true }).inputValue(), '');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Backup browser: empty/truncated/wrong-kind/checksum reject, cancel/retry, full restore + atomic checkpoint passed.');
    console.log('Money browser: 320/360/393/430/768px, decimal persistence and free-vs-unknown passed.');
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
