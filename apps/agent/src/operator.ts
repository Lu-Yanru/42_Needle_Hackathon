import { join, resolve } from "node:path";

export interface OperatorPrompt {
  ts: string;
  text: string;
  intervention: boolean;
}

function queuePath(logDir: string): string {
  return join(resolve(logDir), "operator-prompts.jsonl");
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function enqueueOperatorPrompt(
  logDir: string,
  text: string,
  intervention = true,
): Promise<OperatorPrompt> {
  const prompt: OperatorPrompt = {
    ts: nowIso(),
    text: text.trim(),
    intervention,
  };
  const path = queuePath(logDir);
  const existing = (await Bun.file(path).text().catch(() => "")) || "";
  const line = `${JSON.stringify(prompt)}\n`;
  await Bun.write(path, `${existing}${line}`);
  return prompt;
}

export async function drainOperatorPrompts(logDir: string): Promise<OperatorPrompt[]> {
  const path = queuePath(logDir);
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const raw = await file.text().catch(() => "");
  if (!raw.trim()) return [];

  const prompts: OperatorPrompt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as OperatorPrompt;
      if (parsed.text?.trim()) prompts.push(parsed);
    } catch {
      // Ignore malformed lines so one bad write does not block the queue.
    }
  }

  await Bun.write(path, "");
  return prompts;
}
