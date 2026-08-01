import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertTrustedMutation: vi.fn(),
  getCurrentUser: vi.fn(),
  getContainer: vi.fn(),
}));

vi.mock("@/features/auth/server/http", () => ({
  assertTrustedMutation: mocks.assertTrustedMutation,
}));
vi.mock("@/features/auth/server/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/container", () => ({ getContainer: mocks.getContainer }));

import { POST } from "@/app/api/analyses/[jobId]/challenges/route";

const jobId = "11111111-1111-4111-8111-111111111111";
const submitChallenge = vi.fn();

describe("challenge route access", () => {
  beforeEach(() => {
    mocks.assertTrustedMutation.mockReturnValue(null);
    mocks.getCurrentUser.mockResolvedValue({ id: "owner-1", username: "owner" });
    mocks.getContainer.mockReturnValue({ submitChallenge });
    submitChallenge.mockResolvedValue({
      ok: true,
      messageId: "22222222-2222-4222-8222-222222222222",
      revisionId: "33333333-3333-4333-8333-333333333333",
      created: true,
      status: "completed",
    });
  });

  it("uses only the authenticated user's ID for a valid targeted challenge", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "completed" });
    expect(submitChallenge).toHaveBeenCalledWith({
      userId: "owner-1",
      jobId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这项风险误读了原文。",
      idempotencyKey: "challenge-1",
    });
  });

  it("returns 404 instead of revealing a foreign job", async () => {
    submitChallenge.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 when the well-formed target is absent or ambiguous", async () => {
    submitChallenge.mockResolvedValue({ ok: false, code: "INVALID_TARGET" });

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
  });

  it("rejects a body jobId instead of letting it override the pathname", async () => {
    const response = await POST(request({
      jobId: "99999999-9999-4999-8999-999999999999",
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这项风险误读了原文。",
      idempotencyKey: "challenge-1",
    }), context());

    expect(response.status).toBe(400);
    expect(submitChallenge).not.toHaveBeenCalled();
  });

  it("rejects an untrusted origin before authentication or persistence", async () => {
    mocks.assertTrustedMutation.mockReturnValue(
      Response.json({ error: "请求来源无效" }, { status: 403 }),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(submitChallenge).not.toHaveBeenCalled();
  });

  it("rejects malformed targets and empty challenge content", async () => {
    const response = await POST(request({
      target: { moduleType: "risks", section: "items" },
      content: " ",
      idempotencyKey: "challenge-1",
    }), context());

    expect(response.status).toBe(400);
    expect(submitChallenge).not.toHaveBeenCalled();
  });
});

function request(body: unknown = {
  target: { moduleType: "risks", section: "items", itemId: "risk-1" },
  content: "这项风险误读了原文。",
  idempotencyKey: "challenge-1",
}) {
  return new Request(`http://localhost/api/analyses/${jobId}/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ jobId }) };
}
