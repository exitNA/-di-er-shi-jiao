import { expect, it } from "vitest";
import { Argon2PasswordHasher } from "@/features/auth/server/password";

it("hashes and verifies with Argon2id", async () => {
  const hasher = new Argon2PasswordHasher();
  const encoded = await hasher.hash("复杂 密码 123456");

  expect(encoded).toMatch(/^\$argon2id\$/);
  await expect(hasher.verify(encoded, "复杂 密码 123456")).resolves.toBe(true);
  await expect(hasher.verify(encoded, "wrong password")).resolves.toBe(false);
});
