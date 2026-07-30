import { expect, test } from "./fixtures";

test("renders modules progressively and restores them after reload", async ({
  page,
}) => {
  await page.goto("/register");
  await page.getByLabel("用户名").fill("baseline_reader");
  await page.getByLabel("密码").fill("a secure baseline password");
  await page.getByRole("button", { name: "创建账号" }).click();

  await page
    .getByLabel("想分析的内容")
    .fill("这项政策必然让每个人受益，因为支持者都这样认为。");
  await page.getByRole("button", { name: "开始分析" }).click();

  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "论证骨架" })).toBeVisible();
  await expect(page.getByText("论证骨架已完成")).toBeVisible();
  await expect(page.getByText("信源对照分析中")).toBeVisible();
  await page.reload();
  await expect(page.getByText("论证骨架已完成")).toBeVisible();
  await expect(page.getByText("认知体检已完成")).toBeVisible();
});
