import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  registrationSchema,
} from "@/features/auth/domain/credentials";

describe("credentials", () => {
  it("normalizes username case and rejects punctuation", () => {
    expect(normalizeUsername("Second_View")).toBe("second_view");
    expect(() =>
      registrationSchema.parse({
        username: "第二视角",
        password: "long enough password",
      }),
    ).toThrow();
  });

  it("accepts unicode and spaces in a 12-character password", () => {
    expect(
      registrationSchema.parse({
        username: "reader_1",
        password: "复杂 密码 123456",
      }),
    ).toBeTruthy();
  });
});
