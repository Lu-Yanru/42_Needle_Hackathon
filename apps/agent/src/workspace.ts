// Path-sandboxed file operations + whole-workspace snapshot/restore.
// Snapshot/restore powers rollback-on-regression in the test loop.
// Uses Bun's native APIs: Bun.file, Bun.write, Bun.Glob.

import { isAbsolute, join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", ".turbo", "dist"]);

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a path, rejecting anything that escapes the workspace root. */
  resolvePath(path: string): string {
    const full = resolve(isAbsolute(path) ? path : join(this.root, path));
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      throw new Error(`path "${path}" escapes the workspace`);
    }
    return full;
  }

  async readFile(path: string): Promise<string> {
    const file = Bun.file(this.resolvePath(path));
    return (await file.exists()) ? file.text() : "";
  }

  async fileExists(path: string): Promise<boolean> {
    return Bun.file(this.resolvePath(path)).exists();
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Bun.write creates any missing parent directories.
    await Bun.write(this.resolvePath(path), content);
  }

  /** Every file in the workspace, as paths relative to the root, sorted. */
  async listFiles(): Promise<string[]> {
    const glob = new Bun.Glob("**/*");
    const out: string[] = [];
    try {
      for await (const rel of glob.scan({ cwd: this.root, onlyFiles: true, dot: false })) {
        if (rel.split("/").some((segment) => SKIP_DIRS.has(segment))) continue;
        out.push(rel);
      }
    } catch {
      return []; // workspace directory does not exist yet
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  /** Snapshot every file (path -> content). */
  async snapshot(): Promise<Map<string, string>> {
    const snap = new Map<string, string>();
    for (const rel of await this.listFiles()) {
      snap.set(rel, await this.readFile(rel));
    }
    return snap;
  }

  /** Restore to a snapshot: delete files created since, rewrite the rest. */
  async restore(snap: Map<string, string>): Promise<void> {
    for (const rel of await this.listFiles()) {
      if (!snap.has(rel)) {
        await Bun.file(this.resolvePath(rel)).delete();
      }
    }
    for (const [rel, content] of snap) {
      await Bun.write(this.resolvePath(rel), content);
    }
  }
}
