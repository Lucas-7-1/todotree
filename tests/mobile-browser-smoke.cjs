/* Real browser visual/interaction gate. Run with PLAYWRIGHT_MODULE pointing to playwright. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 4179, strictPort: true },
  });
  await server.listen();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const out = process.env.MOBILE_QA_DIR || "docs/mobile-preview3";
  await fs.mkdir(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    timezoneId: "Asia/Shanghai",
    recordVideo: { dir: out, size: { width: 393, height: 852 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("qa-seeded")) return;
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const now = new Date().toISOString();
      const task = (id, title, parent_id = null, extra = {}) => ({
        id,
        title,
        parent_id,
        root_bucket: parent_id ? null : "categories",
        note: "",
        sort_order: Number(id.replace(/\D/g, "")) || 0,
        status: "open",
        completed_at: null,
        archived_at: null,
        due_type: "none",
        due_date: null,
        due_at: null,
        quadrant: null,
        planned_date: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        deletion_batch_id: null,
        ...extra,
      });
      const tasks = [
        task("p1", "贵州行"),
        task("p2", "出行准备", "p1"),
        task("t1", "确认博物馆预约时间", "p2", {
          planned_date: today,
          due_type: "date",
          due_date: today,
          quadrant: "Q1",
        }),
        task("t2", "整理随身行李清单", "p2", { planned_date: today }),
        task("p3", "旅途安排", "p1"),
        task("t3", "核对酒店入住信息", "p3", {
          planned_date: today,
          quadrant: "Q2",
        }),
        task("t4", "回复供应商的报价邮件", null, { planned_date: today }),
        task("t5", "完成本周采购交接说明并确认待处理合同的后续负责人", null, {
          planned_date: today,
        }),
        task("t6", "晚上散步二十分钟", null, { planned_date: today }),
        task("later", "下周整理电脑文件"),
        task("old", "补交差旅材料", null, {
          due_type: "date",
          due_date: "2026-01-01",
        }),
      ];
      localStorage.setItem("todotree_tasks_v1", JSON.stringify(tasks));
      localStorage.setItem(
        "todotree_settings_v1",
        JSON.stringify({
          timezone: "Asia/Shanghai",
          initialized: true,
          reduced_motion: false,
          show_completed: true,
          schema_version: 2,
        }),
      );
      sessionStorage.setItem("qa-seeded", "yes");
    });
    await page.goto("http://127.0.0.1:4179");
    await page.locator(".m-task").first().waitFor();
    await page
      .locator('[aria-label="正在保护数据"]')
      .waitFor({ state: "hidden" });
    const assertFits = async () => {
      const r = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        task: [...document.querySelectorAll(".m-task")].map(
          (e) => e.getBoundingClientRect().right,
        ),
        composer: document.querySelector(".m-composer")?.getBoundingClientRect()
          .bottom,
        nav: document
          .querySelector(".mobile-navigation")
          ?.getBoundingClientRect().top,
      }));
      assert.ok(r.scroll <= r.width + 1, JSON.stringify(r));
      assert.ok(r.task.every((x) => x <= r.width + 1));
      if (r.composer) assert.ok(r.composer <= r.nav + 1);
    };
    for (const width of [360, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      await assertFits();
      await page.screenshot({ path: `${out}/today-${width}.png` });
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await page
      .getByRole("button", { name: "勾选完成 确认博物馆预约时间", exact: true })
      .click();
    await page
      .getByRole("button", { name: "勾选完成 整理随身行李清单", exact: true })
      .click();
    assert.equal(await page.locator(".m-task.is-pending").count(), 2);
    await page.screenshot({ path: `${out}/confirmation.png` });
    await page
      .getByRole("button", { name: "确认完成 2 项", exact: true })
      .click();
    await page.locator('[data-task-id="t1"]').waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.locator('[data-task-id="p1"] .m-task-open').click();
    await page.locator('[data-task-id="p2"].is-done').waitFor();
    assert.equal(await page.locator('[data-task-id="p3"]').count(), 1);
    await assertFits();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/project-retained-branch.png` });
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const dragTo = async (id, target, inside = true, ancestor = false) => {
      const from = await page.locator(`[data-drag-title="${id}"]`).boundingBox();
      const sx = from.x + from.width / 2, sy = from.y + from.height / 2;
      await touch('touchStart', sx, sy);
      await page.locator('.m-drag-float').waitFor();
      const to = await page.locator(target).boundingBox();
      const tx = to.x + to.width / 2, ty = ancestor || inside ? to.y + to.height / 2 : to.y + 3;
      for (let i = 1; i <= 12; i++) {
        await touch('touchMove', sx + (tx - sx) * i / 12, sy + (ty - sy) * i / 12);
        await page.waitForTimeout(20);
      }
      if (inside && !ancestor) await page.locator('.drop-inside.drop-ready').waitFor();
      else await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/drag-${ancestor ? 'out' : inside ? 'inside' : 'sort'}-preview.png` });
      await touch('touchEnd', tx, ty);
      await page.locator('.m-drag-float').waitFor({ state: 'hidden' });
      await page.locator('.m-saving').waitFor({ state: 'hidden' });
      await page.waitForTimeout(100);
    };
    const storedTasks = () => page.evaluate(async () => (await (await import('/src/services/durableStore.ts')).loadWorkspace()).data.tasks);
    await dragTo('p2', '[data-tree-row="p3"]');
    assert.equal((await storedTasks()).find(t => t.id === 'p2').parent_id, 'p3');
    assert.equal((await storedTasks()).find(t => t.id === 'p1').status, 'open');
    await page.screenshot({ path: `${out}/tree-inline-expanded.png` });
    await dragTo('p2', '[data-drop-parent="p1"]', false, true);
    assert.equal((await storedTasks()).find(t => t.id === 'p2').parent_id, 'p1');
    await dragTo('p2', '[data-tree-row="p3"]', false);
    const ordered = (await storedTasks()).filter(t => t.parent_id === 'p1').sort((a,b) => a.sort_order-b.sort_order);
    assert.equal(ordered[0].id, 'p2');
    for (const width of [320, 360, 393, 430]) {
      await page.setViewportSize({ width, height: 852 }); await assertFits();
      await page.screenshot({ path: `${out}/tree-${width}.png` });
    }
    await page.setViewportSize({ width: 393, height: 852 });

    await page.getByRole("button", { name: "返回上一级", exact: true }).click();
    await page
      .getByRole("button", { name: "更多操作 下周整理电脑文件", exact: true })
      .click();
    await page.getByRole("button", { name: "添加子任务", exact: true }).click();
    await page
      .getByRole("textbox", { name: "子任务名称", exact: true })
      .fill("首次新增子任务");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .locator(".m-task-title", { hasText: "首次新增子任务" })
      .waitFor();
    await page
      .getByRole("button", { name: "更多操作 首次新增子任务", exact: true })
      .click();
    await page.getByRole("button", { name: "添加子任务", exact: true }).click();
    await page
      .getByRole("textbox", { name: "子任务名称", exact: true })
      .fill("首次新增孙任务");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .locator(".m-task-title", { hasText: "首次新增孙任务" })
      .waitFor();
    await page.screenshot({ path: `${out}/nested-project.png` });
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page
      .getByRole("textbox", { name: "任务标题", exact: true })
      .fill("只写标题的今日事项");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await page
      .locator(".m-task-title", { hasText: "只写标题的今日事项" })
      .waitFor();
    await page
      .getByRole("button", { name: "设置新任务属性", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "任务标题", exact: true })
      .fill("长标题录入与键盘场景");
    await page.setViewportSize({ width: 393, height: 510 });
    await page.evaluate(() =>
      document.documentElement.classList.add("keyboard-open"),
    );
    await page.locator(".mobile-navigation").waitFor({ state: "hidden" });
    await page.screenshot({ path: `${out}/editor-keyboard-layout.png` });
    await page
      .getByRole("button", { name: "收起新增面板", exact: true })
      .click();
    await page.evaluate(() =>
      document.documentElement.classList.remove("keyboard-open"),
    );
    await page.setViewportSize({ width: 393, height: 852 });
    await page.locator(".m-date-link").click();
    await page.locator(".calendar-day-detail").waitFor();
    await page.screenshot({ path: `${out}/calendar.png` });
    await page.getByRole("button", { name: "返回上一级", exact: true }).click();
    await page.getByRole("button", { name: "四象限", exact: true }).click();
    await page.screenshot({ path: `${out}/quadrants.png` });
    await assertFits();
    await page.getByRole("button", { name: "复盘", exact: true }).click();
    await page.locator(".m-review-header").waitFor();
    await page.screenshot({ path: `${out}/review.png` });
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "26px"),
    );
    await assertFits();
    await page.screenshot({ path: `${out}/large-font.png` });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.reload();
    await page
      .locator(".m-task-title", { hasText: "只写标题的今日事项" })
      .waitFor();
    await page.evaluate(async () => {
      const store = await import('/src/services/durableStore.ts');
      await store.commitWorkspace(data => {
        const base = data.tasks[0];
        const tasks = Array.from({ length: 501 }, (_, i) => ({ ...base, id: `bench-${i}`, title: i === 0 ? '大型项目' : `任务 ${i}`, parent_id: i ? 'bench-0' : null,
          root_bucket: i ? null : 'categories', status: 'open', completed_at: null, archived_at: null, deleted_at: null, planned_date: null,
          due_type: 'none', due_date: null, quadrant: null, sort_order: i * 1024 }));
        return { ...data, tasks };
      });
      localStorage.removeItem('todotree.mobile.expanded.v1');
      // New isolated browser fixture: discard the old document's desktop tab lease.
      // Native Android uses a single activity and does not acquire this browser-only lock.
      localStorage.removeItem('todotree_active_tab_id');
    });
    await page.reload();
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await page.locator('[data-drag-title="bench-0"]').click();
    for (let i = 0; i < 22; i++) {
      await page.locator('.m-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(60);
    }
    await page.locator('[data-tree-row="bench-500"]').waitFor();
    const renderedRows = await page.locator('[data-tree-row]').count();
    assert.ok(renderedRows < 40, `500-task project mounted ${renderedRows} rows`);
    await page.locator('[data-drag-title="bench-500"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/large-tree-before-drag.png` });
    await dragTo('bench-500', '[data-tree-row="bench-499"]');
    assert.equal((await storedTasks()).find(t => t.id === 'bench-500').parent_id, 'bench-499');
    await page.screenshot({ path: `${out}/large-tree-window.png` });
    assert.equal(errors.length, 0, errors.join("\n"));
    await fs.writeFile(
      `${out}/browser-result.json`,
      JSON.stringify(
        {
          passed: true,
          largeTree: { nodes: 501, renderedRows, canDragPastFirst50: true },
          viewports: [360, 393, 430],
          tested: [
            "native-touch-drag-inside", "native-touch-drag-out", "drag-sibling-sort", "tree-overflow-320-430",
            "multi-confirm",
            "retained-branch",
            "first-child",
            "first-grandchild",
            "title-only-add",
            "reload-persistence",
            "calendar",
            "quadrant",
            "review",
            "keyboard-layout-simulation",
          ],
          note: "Chromium mobile viewport; actual Android keyboard and safe areas are tested separately.",
          errors,
        },
        null,
        2,
      ),
    );
    console.log("Mobile browser smoke passed");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
