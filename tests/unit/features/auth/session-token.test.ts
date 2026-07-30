import { expect, it } from "vitest";
import {
  createSessionToken,
  hashSessionToken,
} from "@/features/auth/server/session-token";

it("creates a 256-bit token and only persists its hash", () => {
  const token = createSessionToken();

  expect(Buffer.from(token, "base64url")).toHaveLength(32);
  expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
});
