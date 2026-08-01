import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test("returns 404 for another user's snapshot, events, and retry", async ({
  browser,
}) => {
  const userA = await browser.newContext();
  const pageA = await userA.newPage();
  await register(pageA, "ownership_reader_a");
  await pageA.getByLabel("想分析的内容").fill("用户 A 的私有报告。");
  await pageA.getByRole("button", { name: "开始分析" }).click();
  await expect(pageA).toHaveURL(/\/analysis\/[^/]+$/);
  const jobId = new URL(pageA.url()).pathname.split("/").at(-1)!;

  const userB = await browser.newContext();
  const pageB = await userB.newPage();
  await register(pageB, "ownership_reader_b");

  const statuses = await pageB.evaluate(async (id) => {
    const [snapshot, events, retry] = await Promise.all([
      fetch(`/api/analyses/${id}`),
      fetch(`/api/analyses/${id}/events`),
      fetch(`/api/analyses/${id}/modules/sources/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    ]);
    return [snapshot.status, events.status, retry.status];
  }, jobId);

  expect(statuses).toEqual([404, 404, 404]);
  await userA.close();
  await userB.close();
});

async function register(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill("a secure ownership password");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");
}
