import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const challenge = "这项风险误读了原文，请重新核对。";
const response = "复核后，这项质疑成立，报告已更新。";
const revisionTarget = "认知风险 / 风险条目 / risk-overgeneralization";
const revisionReason = "修订理由：原结论超出当前材料能够支持的范围。";
const revisionEvidence = "新增证据：无";

test("persists a challenged cognitive-risk revision after reload", async ({ page }) => {
  await register(page, "conversation_revision_reader");
  await page
    .getByLabel("想分析的内容")
    .fill("这项政策必然让每个人受益，因为支持者都这样认为。");
  await page.getByRole("button", { name: "开始分析" }).click();

  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  await expect(page.getByRole("button", { name: "质疑：认知风险" })).toBeVisible();
  await page.getByRole("button", { name: "质疑：认知风险" }).click();
  await page.getByLabel("质疑内容").fill(challenge);
  await page.getByRole("button", { name: "提交质疑" }).click();

  await expect(page.getByText(response)).toBeVisible();
  await expect(page.getByRole("link", { name: revisionTarget })).toBeVisible();
  await expect(page.getByText(revisionReason)).toBeVisible();
  await expect(page.getByText(revisionEvidence)).toBeVisible();

  await page.reload();

  await expect(page.getByText(response)).toBeVisible();
  await expect(page.getByRole("link", { name: revisionTarget })).toBeVisible();
  await expect(page.getByText(revisionReason)).toBeVisible();
  await expect(page.getByText(revisionEvidence)).toBeVisible();

  await page.getByRole("link", { name: revisionTarget }).click();
  await expect(page).toHaveURL(/#report-module-risks$/);
  await expect(page.locator("#report-module-risks")).toBeFocused();
});

async function register(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill("a secure conversation password");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");
}
