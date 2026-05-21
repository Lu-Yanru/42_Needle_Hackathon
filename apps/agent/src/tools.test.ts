import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTools } from "./tools/index";
import { Workspace } from "./workspace";

describe("edit_file tool", () => {
  test("replaces a targeted snippet without rewriting the whole file", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-tools-"));
    try {
      const workspace = new Workspace(root);
      await workspace.writeFile("solution.py", "print('old')\n").then((res) => {
        if (res.isErr()) throw res.error;
      });

      const tools = createTools({ workspace });
      const editTool = tools.find((tool) => tool.name === "edit_file");
      expect(editTool).toBeDefined();

      const result = await editTool!.run({
        path: "solution.py",
        search: "print('old')",
        replace: "print('new')",
      });

      expect(result.isError).toBeFalsy();
      const updated = await workspace.readFile("solution.py");
      expect(updated.unwrapOr("")).toBe("print('new')\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails cleanly when the target snippet is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-tools-"));
    try {
      const workspace = new Workspace(root);
      await workspace.writeFile("solution.py", "print('old')\n").then((res) => {
        if (res.isErr()) throw res.error;
      });

      const tools = createTools({ workspace });
      const editTool = tools.find((tool) => tool.name === "edit_file");
      expect(editTool).toBeDefined();

      const result = await editTool!.run({
        path: "solution.py",
        search: "print('missing')",
        replace: "print('new')",
      });

      expect(result.isError).toBeTrue();
      expect(result.content).toContain("Target text not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
