import { expect, test } from "./fixtures";

test("reopens an older saved report from owned history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByLabel("用户名").fill("history_reader");
  await page.getByLabel("密码").fill("a secure history password");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");

  await page.getByLabel("想分析的内容").fill("较早的报告：远程办公只会提高效率。");
  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  const olderUrl = page.url();
  await expect(page.getByText("认知体检已完成")).toBeVisible();

  await page.goto("/");
  await page.getByLabel("想分析的内容").fill("较新的报告：城市中心取消停车位对每个人都有利。");
  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);

  await page.goto("/history");
  const reports = page.getByRole("listitem");
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0)).toContainText("较新的报告");
  await expect(reports.nth(1)).toContainText("较早的报告");

  await reports.nth(1).getByRole("link", { name: "打开报告" }).click();
  await expect(page).toHaveURL(olderUrl);
  await page.reload();
  await expect(page.getByText("论证骨架已完成")).toBeVisible();
});
