const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 4186, strictPort: true },
  });
  await server.listen();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      timezoneId: "Asia/Shanghai",
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const out = process.env.MOBILE_QA_DIR || "/tmp/todotree-life-qa";
  await fs.mkdir(out, { recursive: true });
  const state = () =>
    page.evaluate(
      async () =>
        (await (await import("/src/services/health/store.ts")).readHealth())
          .records,
    );
  const tasks = () =>
    page.evaluate(
      async () =>
        (await (await import("/src/services/durableStore.ts")).loadWorkspace())
          .data.tasks,
    );
  const waitUntil = async (check) => {
    const until = Date.now() + 10000;
    while (!(await check())) {
      if (Date.now() > until)
        throw Error("Timed out waiting for durable state");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const mode = (name) =>
    page
      .locator(".h-shell > .app-mode-switch")
      .getByRole("button", { name, exact: true });
  try {
    await page.goto("http://127.0.0.1:4186");
    await page.locator(".m-workspace").waitFor();
    await page
      .getByRole("navigation", { name: "应用模式" })
      .getByRole("button", { name: "健康", exact: true })
      .click();
    await page.locator(".h-shell").waitFor();
    await page
      .getByRole("button", { name: "体重 记一次", exact: true })
      .click();
    await page.getByLabel("体重数值", { exact: true }).fill("60");
    assert.equal((await state()).filter((r) => r.kind === "weight").length, 0);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    assert.equal((await state()).find((r) => r.kind === "weight").body.kg, 60);
    await page
      .getByRole("button", { name: "饮食 记一餐", exact: true })
      .click();
    await page.getByLabel("食物名称", { exact: true }).fill("自制炒饭");
    await page.getByLabel("食物克重", { exact: true }).fill("150");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    assert.equal(
      (await state()).find((r) => r.kind === "intake").body.kcal,
      null,
    );
    const day = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    const prior = new Date(day + "T12:00:00Z");
    prior.setUTCDate(prior.getUTCDate() - 1);
    await page
      .getByRole("button", { name: "睡眠 记一觉", exact: true })
      .click();
    await page
      .getByLabel("睡眠开始", { exact: true })
      .fill(prior.toISOString().slice(0, 10) + "T23:00");
    await page.getByLabel("睡眠结束", { exact: true }).fill(day + "T07:00");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    assert.equal((await state()).find((r) => r.kind === "sleep").day, day);
    await page.screenshot({ path: out + "/health-today.png" });
    await page.getByRole("button", { name: "计划", exact: true }).click();
    await page.getByRole("button", { name: /^俯卧撑基础/ }).click();
    await page.getByLabel("组数 1", { exact: true }).fill("2");
    await page.getByLabel("休息秒数 1", { exact: true }).fill("15");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    const template = page.locator(".h-template");
    await template
      .getByRole("button", { name: "加入今天", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".h-notice")?.textContent.includes("已加入今天"),
    );
    await template
      .getByRole("button", { name: "加入今天", exact: true })
      .click();
    await page.waitForTimeout(100);
    assert.equal(
      (await tasks()).filter((t) => t.health_occurrence_id).length,
      1,
    );
    assert.equal((await state()).filter((r) => r.kind === "session").length, 0);
    await mode("待办").click();
    await page.locator(".h-shell").waitFor({ state: "hidden" });
    await page
      .locator(".m-task")
      .getByRole("button", { name: "开始训练", exact: true })
      .click();
    await page.locator(".h-runner").waitFor();
    await page.getByRole("button", { name: "开始本组", exact: true }).click();
    await page
      .getByRole("button", { name: "展开互动计次", exact: true })
      .click();
    for (let i = 1; i <= 6; i++) {
      await page
        .getByRole("button", { name: "记录一次动作", exact: true })
        .click();
      await page.waitForFunction(
        (n) =>
          document.querySelector(".h-rep-face strong")?.firstChild
            ?.textContent === String(n),
        i,
      );
    }
    await page.getByRole("button", { name: "本组已做完", exact: true }).click();
    await page.locator(".h-rest-face").waitFor();
    assert.equal(
      (await state()).find((r) => r.kind === "session").body.logs[0].actual,
      10,
    );
    await page.screenshot({ path: out + "/workout-rest.png" });
    await page.reload();
    await page.getByRole("button", { name: /继续未结束的训练/ }).click();
    await page.locator(".h-runner").waitFor();
    assert.equal(
      (await state()).find((r) => r.kind === "session").body.logs.length,
      1,
    );
    await page.getByRole("button", { name: "结束休息", exact: true }).click();
    await page.getByRole("button", { name: "开始下一组", exact: true }).click();
    await page.getByRole("button", { name: "本组已做完", exact: true }).click();
    await page.locator(".h-session-result").waitFor();
    await waitUntil(async () =>
      (await tasks()).some(
        (t) => t.health_occurrence_id && t.status === "done",
      ),
    );
    const done = (await state()).find((r) => r.kind === "session");
    assert.equal(done.body.logs.length, 2);
    assert.equal(
      done.body.logs.reduce((n, l) => n + l.actual, 0),
      20,
    );
    assert.equal(done.body.rest, null);
    await page.screenshot({ path: out + "/workout-result.png" });
    await page
      .getByRole("button", { name: "回到健康今天", exact: true })
      .click();
    await page
      .getByRole("button", { name: "记录操作 60 kg", exact: true })
      .click();
    await page.getByRole("button", { name: "编辑记录", exact: true }).click();
    await page.getByLabel("体重数值", { exact: true }).fill("59.8");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    assert.equal((await state()).filter((r) => r.kind === "weight").length, 1);
    await page
      .getByRole("button", { name: "记录操作 59.8 kg", exact: true })
      .click();
    await page.getByRole("button", { name: "移入回收站", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector(".h-notice")?.textContent.includes("已移入"),
    );
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() =>
      document.querySelector(".h-notice")?.textContent.includes("已撤销删除"),
    );
    assert.equal(
      (await state()).find((r) => r.kind === "weight").deleted_at,
      null,
    );
    await page.reload();
    await page.locator(".h-shell").waitFor();
    assert.equal(
      (await state()).filter(
        (r) => !r.deleted_at && ["weight", "sleep", "intake"].includes(r.kind),
      ).length,
      3,
    );
    for (const width of [360, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      assert.equal(
        await page
          .locator(".h-shell")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await page.screenshot({ path: out + "/health-" + width + ".png" });
    }
    const outstanding = (await state()).filter(
      (r) => r.kind === "outbox" && r.body.status === "pending",
    );
    console.log(
      "Outstanding",
      outstanding.map((r) => r.body),
    );
    assert.equal(outstanding.length, 0);
    await page
      .getByRole("button", { name: "体重 59.8kg", exact: true })
      .click();
    await page.getByLabel("体重数值", { exact: true }).fill("59.7");
    await waitUntil(async () =>
      (await state()).some(
        (r) => r.kind === "draft" && !r.deleted_at && r.body.weight === "59.7",
      ),
    );
    await page.reload();
    await page.locator(".h-shell").waitFor();
    await page
      .getByRole("button", { name: /继续未保存的体重记录/ })
      .click({ timeout: 5000 });
    assert.equal(
      await page.getByLabel("体重数值", { exact: true }).inputValue(),
      "59.7",
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "计划", exact: true }).click();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.getByLabel("训练模板名称", { exact: true }).fill("旅行训练草稿");
    await waitUntil(async () =>
      (await state()).some(
        (r) =>
          r.kind === "draft" &&
          !r.deleted_at &&
          r.body.value?.title === "旅行训练草稿",
      ),
    );
    await page.reload();
    await page.getByRole("button", { name: "计划", exact: true }).click();
    await page.getByRole("button", { name: /继续编辑 旅行训练草稿/ }).click();
    assert.equal(
      await page.getByLabel("训练模板名称", { exact: true }).inputValue(),
      "旅行训练草稿",
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator(".h-editor").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page
      .getByRole("button", { name: "记录操作 59.7 kg", exact: true })
      .click();
    await page.getByRole("button", { name: "编辑记录", exact: true }).click();
    await page.getByLabel("体重数值", { exact: true }).fill("59.6");
    await page
      .getByRole("button", { name: "返回健康并保留草稿", exact: true })
      .click();
    const conflictId = await page.evaluate(async () => {
      const api = await import("/src/services/health/store.ts");
      const r = (await api.readHealth()).records.find(
        (r) => r.kind === "weight" && r.body.kg === 59.7,
      );
      await api.commitHealth(() => [{ ...r, body: { ...r.body, kg: 59.5 } }]);
      return r.id;
    });
    await page.getByRole("button", { name: /继续未保存的体重记录/ }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "原记录已有新修改" })
      .waitFor();
    assert.equal(
      (await state()).find((r) => r.id === conflictId).body.kg,
      59.5,
    );
    await page
      .getByRole("button", { name: "返回健康并保留草稿", exact: true })
      .click();
    const exported = await page.evaluate(async () =>
      JSON.parse(
        await (await import("/src/services/health/store.ts")).exportHealth(),
      ),
    );
    assert.ok(exported.records.some((r) => r.kind === "session"));
    assert.ok(!JSON.stringify(exported).includes("api_key"));
    assert.deepEqual(errors, []);
    console.log(
      "PASS three modes, actual records, unknown food, template idempotence, today training, six-to-ten, rest recovery, task closure, edit/delete/undo, restart, drafts, stale draft guard, backup and 360/393/430px",
    );
  } catch (error) {
    await page.screenshot({ path: out + "/health-failure.png" });
    console.error(
      "UI",
      (await page.locator("body").innerText()).slice(0, 3000),
    );
    console.error(
      "Drafts",
      (await state()).filter((r) => r.kind === "draft"),
    );
    throw error;
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
