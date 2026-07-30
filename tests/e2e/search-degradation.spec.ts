import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test("keeps content usable while sources fail and completes after retry", async ({
  page,
}) => {
  await register(page);
  await page
    .getByLabel("想分析的内容")
    .fill("[测试：信源失败一次] 信源失败不应阻断其余认知体检内容。");
  await page.getByRole("button", { name: "开始分析" }).click();

  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  await expect(page.getByText(/认知体检部分完成/)).toBeVisible();
  for (const status of [
    "速览已完成",
    "论证骨架已完成",
    "多视角地图已完成",
    "认知风险已完成",
    "思考对话已完成",
  ]) {
    await expect(page.getByText(status)).toBeVisible();
  }
  await expect(page.getByText("信源服务暂时不可用")).toBeVisible();

  const retry = page.getByRole("button", { name: "重试信源对照" });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText("认知体检已完成")).toBeVisible();
  await expect(page.getByText("信源对照已完成")).toBeVisible();
});

async function register(page: Page) {
  await page.goto("/register");
  await page.getByLabel("用户名").fill("source_retry_reader");
  await page.getByLabel("密码").fill("a secure source retry password");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");
}
