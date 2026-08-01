import type { Page } from "@playwright/test";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";
import { expect, test } from "./fixtures";

test("keeps the first module across refresh and streams the rest", async ({
  page,
}) => {
  await register(page, "recovery_refresh");
  await submit(page, "刷新后仍应保留已经完成的论证模块。");

  await expect(page.getByText("论证骨架已完成")).toBeVisible();
  await expect(page.getByText(/信源对照(?:分析中|已完成)/)).toBeVisible();
  await page.reload();

  await expect(page.getByText("论证骨架已完成")).toBeVisible();
  await expect(page.getByText("认知体检已完成")).toBeVisible();
  for (const status of [
    "速览已完成",
    "论证骨架已完成",
    "多视角地图已完成",
    "信源对照已完成",
    "认知风险已完成",
    "思考对话已完成",
  ]) {
    await expect(page.getByText(status)).toBeVisible();
  }
});

test("resumes an interrupted job without replacing completed module versions", async ({
  page,
}) => {
  await register(page, "recovery_resume");
  const jobId = await submit(
    page,
    "[测试：任务中断] 已完成的模块不应在恢复时重新执行。",
  );

  await expect(page.getByText(/认知体检待恢复/)).toBeVisible();
  const before = await snapshot(page, jobId);
  const completedVersions = Object.fromEntries(
    Object.entries(before.modules)
      .filter(([, module]) => module.status === "completed")
      .map(([moduleType, module]) => [moduleType, module.version]),
  ) as Partial<Record<ReportModuleType, number>>;
  expect(completedVersions.argument).toBeDefined();

  await page.getByRole("button", { name: "重试多视角地图" }).click();
  await expect(page.getByText("认知体检已完成")).toBeVisible();
  const after = await snapshot(page, jobId);

  for (const [moduleType, version] of Object.entries(completedVersions)) {
    expect(after.modules[moduleType as ReportModuleType].version).toBe(version);
  }
});

async function register(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill("a secure recovery password");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");
}

async function submit(page: Page, content: string): Promise<string> {
  await page.getByLabel("想分析的内容").fill(content);
  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

async function snapshot(page: Page, jobId: string): Promise<AnalysisSnapshot> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/analyses/${id}`);
    if (!response.ok) throw new Error(`snapshot failed: ${response.status}`);
    return response.json();
  }, jobId);
}
