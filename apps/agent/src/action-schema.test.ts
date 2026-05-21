import { describe, expect, test } from "bun:test";
import { ActionSchema } from "./state";

describe("ActionSchema", () => {
  test("requires search and replace for edit_file actions", () => {
    expect(
      ActionSchema.safeParse({
        tool: "edit_file",
        reasoning: "patch the file",
        path: "solution.py",
      }).success,
    ).toBeFalse();

    expect(
      ActionSchema.safeParse({
        tool: "edit_file",
        reasoning: "patch the file",
        path: "solution.py",
        search: "old",
        replace: "new",
      }).success,
    ).toBeTrue();
  });

  test("requires content for write_file actions", () => {
    expect(
      ActionSchema.safeParse({
        tool: "write_file",
        reasoning: "rewrite file",
        path: "solution.py",
      }).success,
    ).toBeFalse();
  });
});
