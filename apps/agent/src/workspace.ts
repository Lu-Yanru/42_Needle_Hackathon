// Path-sandboxed file operations + whole-workspace snapshot/restore.
// Snapshot/restore powers rollback-on-regression in the test loop.
// Uses Bun's native APIs: Bun.file, Bun.write, Bun.Glob.

import { isAbsolute, join, relative, resolve } from "node:path";
import { Result } from "better-result";
import { FileSystemError, WorkspacePathError } from "./errors";

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", ".turbo", "dist"]);

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a path, rejecting anything that escapes the workspace root. */
  resolvePath(path: string): Result<string, WorkspacePathError> {
    const full = resolve(isAbsolute(path) ? path : join(this.root, path));
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      return Result.err(new WorkspacePathError({ path }));
    }
    return Result.ok(full);
  }

  async readFile(path: string): Promise<Result<string, FileSystemError | WorkspacePathError>> {
    const resolved = this.resolvePath(path);
    if (resolved.isErr()) return resolved;
    return Result.tryPromise({
      try: async () => {
        const file = Bun.file(resolved.value);
        return (await file.exists()) ? file.text() : "";
      },
      catch: (cause) => new FileSystemError({ operation: "read", path, cause }),
    });
  }

  async fileExists(path: string): Promise<Result<boolean, FileSystemError | WorkspacePathError>> {
    const resolved = this.resolvePath(path);
    if (resolved.isErr()) return Result.err(resolved.error);
    return Result.tryPromise({
      try: () => Bun.file(resolved.value).exists(),
      catch: (cause) => new FileSystemError({ operation: "exists", path, cause }),
    });
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileSystemError | WorkspacePathError>> {
    const resolved = this.resolvePath(path);
    if (resolved.isErr()) return Result.err(resolved.error);
    return Result.tryPromise({
      try: async () => {
        // Bun.write creates any missing parent directories.
        await Bun.write(resolved.value, content);
      },
      catch: (cause) => new FileSystemError({ operation: "write", path, cause }),
    });
  }

  async editFile(
    path: string,
    search: string,
    replace: string,
    replaceAll = false,
  ): Promise<Result<number, FileSystemError | WorkspacePathError>> {
    const current = await this.readFile(path);
    if (current.isErr()) return Result.err(current.error);
    const occurrences = current.value.split(search).length - 1;
    if (occurrences < 1) {
      return Result.err(
        new FileSystemError({
          operation: "edit",
          path,
          cause: new Error(`Target text not found in ${path}`),
        }),
      );
    }
    const next = replaceAll
      ? current.value.split(search).join(replace)
      : current.value.replace(search, replace);
    const written = await this.writeFile(path, next);
    if (written.isErr()) return Result.err(written.error);
    return Result.ok(replaceAll ? occurrences : 1);
  }

  /** Every file in the workspace, as paths relative to the root, sorted. */
  async listFiles(): Promise<Result<string[], FileSystemError>> {
    const glob = new Bun.Glob("**/*");
    const out: string[] = [];
    const scanned = await Result.tryPromise({
      try: async () => {
        for await (const rel of glob.scan({ cwd: this.root, onlyFiles: true, dot: false })) {
          if (rel.split("/").some((segment) => SKIP_DIRS.has(segment))) continue;
          out.push(rel);
        }
      },
      catch: (cause) => new FileSystemError({ operation: "list", path: this.root, cause }),
    });
    // A missing workspace directory is not an error here — return an empty list.
    if (scanned.isErr()) return Result.ok([]);
    return Result.ok(out.sort((a, b) => a.localeCompare(b)));
  }

  /** Snapshot every file (path -> content). */
  async snapshot(): Promise<Result<Map<string, string>, FileSystemError | WorkspacePathError>> {
    const files = await this.listFiles();
    if (files.isErr()) return Result.err(files.error);
    const snap = new Map<string, string>();
    for (const rel of files.value) {
      const content = await this.readFile(rel);
      if (content.isErr()) return Result.err(content.error);
      snap.set(rel, content.value);
    }
    return Result.ok(snap);
  }

  /** Restore to a snapshot: delete files created since, rewrite the rest. */
  async restore(
    snap: Map<string, string>,
  ): Promise<Result<void, FileSystemError | WorkspacePathError>> {
    const files = await this.listFiles();
    if (files.isErr()) return Result.err(files.error);
    for (const rel of files.value) {
      if (!snap.has(rel)) {
        const resolved = this.resolvePath(rel);
        if (resolved.isErr()) return Result.err(resolved.error);
        const deleted = await Result.tryPromise({
          try: () => Bun.file(resolved.value).delete(),
          catch: (cause) => new FileSystemError({ operation: "delete", path: rel, cause }),
        });
        if (deleted.isErr()) return Result.err(deleted.error);
      }
    }
    for (const [rel, content] of snap) {
      const written = await this.writeFile(rel, content);
      if (written.isErr()) return Result.err(written.error);
    }
    return Result.ok(undefined);
  }
}
