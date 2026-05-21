// Structured, timestamped logging into the 7 files judges require under
// agent_logs/. human_interventions.log is created with a header and filled
// by hand; final_report.md is written once at the end of a run.

import { join, resolve } from "node:path";
import { Result } from "better-result";
import { FileSystemError } from "./errors";

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

const HEADERS: Record<string, string> = {
  "prompts.log": "# prompts.log — prompts/instructions sent to the agent\n\n",
  "decisions.log": "# decisions.log — important agent decisions\n\n",
  "commands.log": "# commands.log — commands run by the agent or humans\n\n",
  "test_runs.log": "# test_runs.log — test runs and score progression\n\n",
  "errors.log": "# errors.log — crashes, tool failures, stuck loops\n\n",
};

const HUMAN_INTERVENTIONS_HEADER =
  "# human_interventions.log — manual actions after the hidden task release\n" +
  "# Format per entry:\n" +
  "# [YYYY-MM-DD HH:MM:SS] TYPE\n" +
  "# What happened / Why / Files or settings affected / Touched final task code: yes-no\n\n" +
  "No human interventions after hidden task release.\n\n";

export class Logger {
  readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(dir = "agent_logs"): Promise<Logger> {
    const logger = new Logger(resolve(dir));
    await logger.init();
    return logger;
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  private async init(): Promise<void> {
    // Bun.write creates the agent_logs directory on first write.
    for (const [name, header] of Object.entries(HEADERS)) {
      if (!(await Bun.file(this.path(name)).exists())) {
        await Bun.write(this.path(name), header);
      }
    }
    const hi = this.path("human_interventions.log");
    if (!(await Bun.file(hi).exists())) {
      await Bun.write(hi, HUMAN_INTERVENTIONS_HEADER);
    }
  }

  private async append(name: string, text: string): Promise<void> {
    const path = this.path(name);
    // A missing log file reads as empty — fire-and-forget, so failures here
    // collapse to "" rather than rippling a Result into every caller.
    const existing = (
      await Result.tryPromise({
        try: () => Bun.file(path).text(),
        catch: (cause) => new FileSystemError({ operation: "read", path, cause }),
      })
    ).unwrapOr("");
    await Bun.write(path, `${existing}${text}\n`);
  }

  async prompt(phase: string, text: string): Promise<void> {
    await this.append(
      "prompts.log",
      `${timestamp()} PROMPT (phase=${phase})\n${text}\n`,
    );
  }

  async decision(decision: string, reason: string, next = ""): Promise<void> {
    const lines = [
      `${timestamp()} DECISION`,
      `Decision: ${decision}`,
      `Reason: ${reason}`,
    ];
    if (next) lines.push(`Next: ${next}`);
    await this.append("decisions.log", `${lines.join("\n")}\n`);
  }

  async command(
    command: string,
    exitCode: number,
    summary: string,
    runBy = "agent",
  ): Promise<void> {
    const lines = [
      `${timestamp()} COMMAND`,
      `Run by: ${runBy}`,
      `Command: ${command}`,
      `Exit code: ${exitCode}`,
      `Result: ${summary}`,
    ];
    await this.append("commands.log", `${lines.join("\n")}\n`);
  }

  async testRun(
    score: number,
    total: number,
    failing: string[],
    command: string,
  ): Promise<void> {
    const lines = [
      `${timestamp()} TEST_RUN`,
      `Command: ${command}`,
      `Score: ${score}/${total}`,
      `Failing categories: ${failing.length > 0 ? failing.join(", ") : "none"}`,
    ];
    await this.append("test_runs.log", `${lines.join("\n")}\n`);
  }

  async error(
    type: string,
    what: string,
    impact: string,
    action: string,
  ): Promise<void> {
    const lines = [
      `${timestamp()} ERROR`,
      `Type: ${type}`,
      `What: ${what}`,
      `Impact: ${impact}`,
      `Action: ${action}`,
    ];
    await this.append("errors.log", `${lines.join("\n")}\n`);
  }

  async writeFinalReport(content: string): Promise<void> {
    await Bun.write(this.path("final_report.md"), content);
  }
}
