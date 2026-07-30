import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import { expect, test } from "./fixtures";

test("supports the report journey by keyboard with stable accessible updates", async ({
  page,
}) => {
  await page.route("**/api/analyses/*", async (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      !/\/api\/analyses\/[^/]+$/.test(new URL(request.url()).pathname)
    ) {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const body = await response.json() as AnalysisSnapshot;
    if (body.modules.sources.status === "completed") {
      body.modules.sources.payload = {
        claims: [
          {
            id: "accessible-claim",
            text: "可访问的外部信源关系",
            origin: "external_source",
            sourceId: "accessible-source",
            confidence: { score: 0.8, rationale: "验收用信源" },
          },
        ],
        sources: [
          {
            id: "accessible-source",
            title: "可访问性验收信源",
            url: "https://example.com/research",
            domain: "example.com",
            publisher: "示例研究院",
            publishedAt: "2026-07-30T00:00:00.000Z",
            qualityTier: 2,
            excerpt: "用于验证信源链接的名称与元数据。",
          },
        ],
        relations: [
          {
            claimId: "accessible-claim",
            sourceId: "accessible-source",
            relation: "supports",
          },
        ],
        gaps: [],
      };
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto("/register");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("用户名")).toBeFocused();
  await page.keyboard.type("keyboard_reader");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("密码")).toBeFocused();
  await page.keyboard.type("a secure keyboard password");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "创建账号" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");

  const content = page.getByLabel("想分析的内容");
  await content.focus();
  await expect(content).toBeFocused();
  await page.keyboard.type("键盘用户可以完成报告流程。");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "开始分析" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/analysis\/[^/]+$/);
  const reportUrl = page.url();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const historyLink = page.getByRole("link", { name: "历史记录" });
  await expect(historyLink).toBeFocused();
  await expect(page.getByText("认知体检已完成")).toBeVisible();
  await expect(historyLink).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
  await expect(page.getByText("论证骨架已完成")).toBeVisible();

  const sourceLink = page.getByRole("link", { name: "可访问性验收信源" });
  await expect(sourceLink).toHaveAttribute(
    "href",
    "https://example.com/research",
  );
  await expect(sourceLink).toHaveAttribute("target", "_blank");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/history");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "打开报告" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(reportUrl);
  await expect(
    page.getByRole("heading", { name: "认知体检报告" }),
  ).toBeVisible();
});
