const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 4181, strictPort: true },
  });
  await server.listen();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const out = process.env.MOBILE_QA_DIR || "/tmp/todotree-journal-qa";
  await fs.mkdir(out, { recursive: true });
  try {
    await page.goto("http://127.0.0.1:4181");
    await page.locator(".mobile-navigation").waitFor();
    const workspace = () =>
      page.evaluate(
        async () =>
          (
            await (
              await import("/src/services/durableStore.ts")
            ).loadWorkspace()
          ).data.tasks,
      );
    const before = await workspace();
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("todotree:journal")),
    );
    await page.locator(".j-shell").waitFor();
    await page.getByRole("button", { name: "开始记录", exact: true }).click();
    await page
      .getByRole("textbox", { name: "事情描述", exact: true })
      .fill("青云市集散步，吃到了喜欢的烤鸡");
    await page
      .getByRole("textbox", { name: "感受或评价", exact: true })
      .fill("慢慢走很舒服，下次还来");
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "添加照片", exact: true }).click();
    await (await choosing).setFiles(require("node:path").join(__dirname, "fixtures/journal-photo.png"));
    await page.locator(".j-photo-grid img").waitFor();
    await page
      .getByRole("button", { name: "＋ 地点、时间、评分、标签", exact: true })
      .click();
    await page.getByRole("button", { name: "4 星", exact: true }).click();
    await page
      .getByRole("textbox", { name: "地点", exact: true })
      .fill("贵阳青云市集");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".j-editor").waitFor({ state: "hidden" });
    await page.locator(".j-card").waitFor();
    for (const width of [360, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({ path: `${out}/calendar-${width}.png` });
    }
    await page.locator(".j-card").click();
    await page.locator(".j-detail-photo img").waitFor();
    assert.ok(
      (await page.locator(".j-detail").innerText()).includes("这次体验 4 分"),
    );
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("发生日期", { exact: true }).fill("2026-01-15");
    await page
      .getByLabel("手帐标题（选填）", { exact: true })
      .fill("贵阳的慢生活");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".j-editor").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "2026-01-15，1 条记录", exact: true })
      .waitFor();
    await page.reload();
    await page.locator(".mobile-navigation").waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("todotree:journal")),
    );
    await page.getByRole("button", { name: "时间线", exact: true }).click();
    await page.locator(".j-card").waitFor();
    assert.ok(
      (await page.locator(".j-card").innerText()).includes("贵阳的慢生活"),
    );
    await page.locator(".j-card img").waitFor();
    await page.getByRole("button", { name: "搜索手帐", exact: true }).click();
    await page.getByLabel("搜索手帐内容", { exact: true }).fill("慢生活");
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".j-card").count(), 1);
    await page.locator(".j-card").click();
    await page.getByRole("button", { name: "移入回收站", exact: true }).click();
    await page.locator(".j-card").waitFor({ state: "hidden" });
    await page
      .locator(".j-toast")
      .getByRole("button", { name: "撤销", exact: true })
      .click();
    await page.locator(".j-card").waitFor();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    await page.getByLabel("事情描述", { exact: true }).fill("明天再整理的草稿");
    await page
      .getByRole("button", { name: "返回手帐并保留草稿", exact: true })
      .click();
    await page.locator(".j-draft-banner").waitFor();
    await page.reload();
    await page.locator(".mobile-navigation").waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("todotree:journal")),
    );
    await page.locator(".j-draft-banner").click();
    await page.locator(".j-draft-row").click();
    assert.equal(
      await page.getByLabel("事情描述", { exact: true }).inputValue(),
      "明天再整理的草稿",
    );
    await page.setViewportSize({ width: 393, height: 490 });
    await page.screenshot({
      path: `out/editor-keyboard.png`.replace("out/", out + "/"),
    });
    assert.ok(
      await page
        .locator(".j-editor .j-header")
        .evaluate((e) => e.getBoundingClientRect().bottom < innerHeight),
    );
    assert.deepEqual(await workspace(), before);
    assert.deepEqual(errors, []);
    console.log(
      "PASS journal UI: photo/text/rating/date/reload/search/trash/undo/draft/360-430px/task isolation",
    );
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
