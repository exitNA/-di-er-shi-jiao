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

  it("accepts a 6-character password and rejects a shorter password", () => {
    expect(
      registrationSchema.parse({
        username: "reader_1",
        password: "密码12ab",
      }),
    ).toBeTruthy();
    expect(() =>
      registrationSchema.parse({
        username: "reader_1",
        password: "密码12a",
      }),
    ).toThrow();
  });
});
