// Bottom-row panels: Timeline, LogsViewer, Workspace, DiffModal,
// InterventionForm, Manifest, FinalReport.

import type {
  InterventionInput,
  Logs,
  Manifest as ManifestData,
  RunStats,
  TimelineEvent,
  WorkspaceFile,
} from "@needle-agent/api/agent/types";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { todayLabel } from "./format";
import { Icon } from "./icons";
import { useToast } from "./toast";

// ---------- TIMELINE ----------

type TimelineFilter = "all" | "decisions" | "tests" | "commands" | "edits" | "human";

const FILTER_MAP: Record<Exclude<TimelineFilter, "all">, TimelineEvent["type"][]> = {
  decisions: ["plan", "decide"],
  tests: ["test", "fail"],
  commands: ["cmd"],
  edits: ["edit"],
  human: ["human"],
};

const TYPE_LABEL: Record<TimelineEvent["type"], string> = {
  plan: "PLN",
  decide: "DEC",
  cmd: "$_",
  test: "TST",
  fail: "FAI",
  edit: "EDT",
  error: "ERR",
  human: "HUM",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    const allow = FILTER_MAP[filter];
    return events.filter((e) => allow.includes(e.type));
  }, [events, filter]);

  const toggle = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filters: TimelineFilter[] = ["all", "decisions", "tests", "commands", "edits", "human"];

  return (
    <div className="card col-7" style={{ height: 560 }}>
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="code" size={12} /> Agent activity
        </span>
        <div className="row" style={{ gap: 4 }}>
          {filters.map((k) => (
            <button
              type="button"
              key={k}
              className={`btn btn-xs ${filter === k ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body scroll" style={{ padding: "4px var(--pad) var(--pad)" }}>
        {filtered.length === 0 && (
          <div className="empty">
            <div className="ic">○</div>No activity
          </div>
        )}
        {filtered.map((e, i) => {
          const id = `${e.ts}-${i}-${e.summary}`;
          const isOpen = expanded.has(id);
          const hasDetail = !!e.detail;
          return (
            <div
              key={id}
              className={`tl-row ${hasDetail ? "expandable" : ""}`}
              onClick={() => hasDetail && toggle(id)}
            >
              <div className="ts">{e.ts.slice(11)}</div>
              <div className={`ic t-${e.type}`}>{TYPE_LABEL[e.type]}</div>
              <div className="body">
                <div className="summary">{e.summary}</div>
                {isOpen && hasDetail && <div className="detail">{e.detail}</div>}
              </div>
              <div className="meta">
                {e.meta}
                {hasDetail && (
                  <span className="chev" style={{ marginLeft: 6 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- LOGS VIEWER ----------

function parseLine(line: string): { ts: string; rest: string } {
  const m = line.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}(?::\d{2})?)\s+([\s\S]*)$/);
  if (m) return { ts: m[1]!, rest: m[2]! };
  return { ts: "", rest: line };
}

function classifyLine(text: string): string {
  const t = text.toLowerCase();
  if (/error|fail|regress|except/.test(t)) return "is-err";
  if (/warn|timeout|skip/.test(t)) return "is-warn";
  if (/pass|ok\b|success/.test(t)) return "is-ok";
  return "";
}

function highlight(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={`h${m.index}`} className="hl">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function LogsViewer({ logs }: { logs: Logs }) {
  const fileNames = Object.keys(logs);
  const [active, setActive] = useState(fileNames[0] ?? "");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const activeName = fileNames.includes(active) ? active : (fileNames[0] ?? "");

  const counts = useMemo(() => {
    const c: Record<string, { lines: number; errors: number }> = {};
    for (const f of fileNames) {
      const lines = logs[f] ?? [];
      c[f] = { lines: lines.length, errors: lines.filter((l) => /error|fail|regress/i.test(l)).length };
    }
    return c;
  }, [logs, fileNames]);

  const lines = logs[activeName] ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return lines.map((l, idx) => ({ l, idx, match: false }));
    const q = query.toLowerCase();
    return lines
      .map((l, idx) => ({ l, idx, match: l.toLowerCase().includes(q) }))
      .filter((x) => x.match);
  }, [lines, query]);

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const copyAll = () => {
    void navigator.clipboard?.writeText((logs[activeName] ?? []).join("\n"));
    toast({ type: "info", title: `Copied ${activeName}`, sub: `${lines.length} lines` });
  };

  return (
    <div className="card col-5 logs" style={{ height: 560 }}>
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="doc" size={12} /> Logs · tail -f
        </span>
        <span className="card-hd-meta">
          <span style={{ color: "var(--text-dim)" }}>{todayLabel()}</span>
          <span
            style={{ width: 1, height: 12, background: "var(--line)", display: "inline-block", margin: "0 8px" }}
          />
          <label className="row" style={{ gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            <span>auto-scroll</span>
          </label>
        </span>
      </div>

      <div className="logs-tabs">
        {fileNames.map((f) => (
          <button
            type="button"
            key={f}
            className={`logs-tab ${activeName === f ? "active" : ""}`}
            onClick={() => setActive(f)}
          >
            <span>{f}</span>
            <span className={`count ${counts[f]!.errors > 0 ? "bad" : ""}`}>
              {counts[f]!.errors > 0 ? counts[f]!.errors : counts[f]!.lines}
            </span>
          </button>
        ))}
      </div>

      <div className="logs-toolbar">
        <span style={{ color: "var(--text-dim)" }}>
          <Icon name="search" size={12} />
        </span>
        <input
          className="logs-search"
          placeholder={`grep ${activeName}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn-xs btn-ghost" onClick={copyAll} title="copy all">
          <Icon name="copy" size={12} /> copy
        </button>
      </div>

      <div className="logs-body" ref={bodyRef}>
        {filtered.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontStyle: "italic", padding: 8 }}>
            {lines.length === 0 ? "(empty)" : `no matches for "${query}"`}
          </div>
        )}
        {filtered.map(({ l, idx, match }) => {
          const { ts, rest } = parseLine(l);
          const cls = classifyLine(rest);
          return (
            <div key={idx} className={`log-line ${cls} ${match ? "match" : ""}`}>
              <span className="lts">{ts}</span>
              <span className="ltx">{highlight(rest, query)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- WORKSPACE ----------

export function Workspace({ files, onOpenDiff }: { files: WorkspaceFile[]; onOpenDiff: (f: WorkspaceFile) => void }) {
  const iconCls: Record<string, string> = { created: "cre", edited: "edt", "rolled-back": "rb" };
  const iconChar: Record<string, string> = { created: "+", edited: "~", "rolled-back": "↶" };
  return (
    <div className="card col-4">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="file" size={12} /> Workspace changes
        </span>
        <span className="card-hd-meta">{files.length} files</span>
      </div>
      <div className="card-body">
        {files.length === 0 && (
          <div className="empty">
            <div className="ic">○</div>No files touched
          </div>
        )}
        {files.map((f) => {
          const status = f.rolledBack ? "rolled-back" : f.status;
          return (
            <div className="ws-row" key={f.path} onClick={() => onOpenDiff(f)}>
              <div className={`ws-icon ${iconCls[status]}`}>{iconChar[status]}</div>
              <div className="ws-path">{f.path}</div>
              <div className="ws-stat">
                {f.added > 0 && <span className="add">+{f.added}</span>}
                {f.removed > 0 && <span className="rem">−{f.removed}</span>}
              </div>
              <div style={{ color: "var(--text-faint)" }}>
                <Icon name="diff" size={12} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- FILE VIEWER MODAL ----------

// Shows the file's real, current contents read live from the agent workspace.
// There is no synthetic before/after diff — every line here is the actual file.
export function DiffModal({ file, onClose }: { file: WorkspaceFile | null; onClose: () => void }) {
  const lines = useMemo(
    () => (file?.content ? file.content.replace(/\n$/, "").split("\n") : []),
    [file],
  );
  if (!file) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 13, color: "var(--text)" }}>
                {file.path}
              </span>
              <span
                className={`pill ${file.rolledBack ? "pill-warn" : file.status === "created" ? "pill-ok" : "pill-info"}`}
              >
                <span className="dot" />
                {file.rolledBack ? "rolled back" : file.status}
              </span>
            </div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 3 }}>
              {file.added} lines · live contents from the agent workspace
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          {lines.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              <div className="ic">○</div>
              (empty file)
            </div>
          ) : (
            lines.map((text, i) => (
              <div key={i} className="diff-line ctx">
                <span className="ln">{i + 1}</span>
                <span className="sg"> </span>
                <span className="tx">{text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- INTERVENTION FORM ----------

const INTERVENTION_TYPES = ["configuration", "observation", "nudge", "rollback", "manual_edit", "other"];

export function InterventionForm({ onSubmit }: { onSubmit: (entry: InterventionInput) => Promise<void> }) {
  const [type, setType] = useState("configuration");
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [files, setFiles] = useState("");
  const [touched, setTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = what.trim() !== "" && why.trim() !== "" && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, what, why, files, touched, notes });
      setWhat("");
      setWhy("");
      setFiles("");
      setTouched(false);
      setNotes("");
      setType("configuration");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card col-4">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="user" size={12} /> Log a human intervention
        </span>
        <span className="card-hd-meta" style={{ color: "var(--warn)" }}>
          honor-system mandatory
        </span>
      </div>
      <form className="card-body" onSubmit={handleSubmit} style={{ overflowY: "auto" }}>
        <div className="form-row">
          <label>type</label>
          <div className="radio-group">
            {INTERVENTION_TYPES.map((t) => (
              <span
                key={t}
                className={`radio-pill ${type === t ? "active" : ""}`}
                onClick={() => setType(t)}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="form-row">
          <label>what happened *</label>
          <input
            className="input"
            placeholder="e.g. Bumped pytest timeout 30s → 60s"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>why *</label>
          <input
            className="input"
            placeholder="e.g. 4 tests timing out on local hardware"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>files / settings affected</label>
          <input
            className="input"
            placeholder="e.g. pytest.ini, .env"
            value={files}
            onChange={(e) => setFiles(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>touched final program code directly</label>
          <div className={`toggle-row ${touched ? "warn-on" : ""}`}>
            <div className="lbl">
              {touched ? (
                <>
                  <b style={{ color: "var(--warn)" }}>YES</b> — counted as material assistance, must be fully
                  disclosed.
                </>
              ) : (
                <>
                  <b style={{ color: "var(--ok)" }}>NO</b> — only tooling / config / observation.
                </>
              )}
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className={`btn btn-xs ${!touched ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTouched(false)}
              >
                no
              </button>
              <button
                type="button"
                className={`btn btn-xs ${touched ? "btn-warn" : "btn-ghost"}`}
                onClick={() => setTouched(true)}
              >
                yes
              </button>
            </div>
          </div>
        </div>

        <div className="form-row">
          <label>notes (optional)</label>
          <textarea
            className="textarea"
            placeholder="any extra context that helps judges understand the decision"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
            style={{ width: "100%", justifyContent: "center", padding: "8px 12px" }}
          >
            <Icon name="send" size={12} /> {submitting ? "Logging…" : "Log intervention"}
          </button>
          <div className="dim mono" style={{ fontSize: 10.5, marginTop: 6, textAlign: "center" }}>
            appends timestamped entry to{" "}
            <span style={{ color: "var(--text-mute)" }}>human_interventions.log</span>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------- MANIFEST ----------

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function Manifest({ manifest, stats }: { manifest: ManifestData; stats: RunStats }) {
  const flags: [string, boolean][] = [
    ["paid_inference", manifest.paid_usage.paid_inference],
    ["paid_apis", manifest.paid_usage.paid_apis],
    ["paid_tools", manifest.paid_usage.paid_tools],
  ];

  return (
    <div className="card col-4">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="cpu" size={12} /> Model disclosure
        </span>
        <span className="card-hd-meta">agent_manifest.json</span>
      </div>
      <div className="card-body">
        <div className="man-row">
          <span className="lbl">primary model</span>
          <span className="val" style={{ color: "var(--accent-2)" }}>
            {manifest.primary_model}
          </span>
        </div>
        <div className="man-row">
          <span className="lbl">provider</span>
          <span className="val">{manifest.provider}</span>
        </div>
        <div className="man-row" style={{ alignItems: "flex-start" }}>
          <span className="lbl">additional models</span>
          <span
            className="val"
            style={{ fontSize: 10.5, textAlign: "right", whiteSpace: "normal", maxWidth: 220, lineHeight: 1.5 }}
          >
            {manifest.additional_models.length === 0 ? (
              <span className="dim">none</span>
            ) : (
              manifest.additional_models.map((m) => (
                <span key={m} style={{ display: "block" }}>
                  {m}
                </span>
              ))
            )}
          </span>
        </div>
        <div className="man-row" style={{ alignItems: "flex-start" }}>
          <span className="lbl">hardware</span>
          <span
            className="val"
            style={{ fontSize: 10.5, textAlign: "right", whiteSpace: "normal", maxWidth: 220, lineHeight: 1.5 }}
          >
            {manifest.hardware}
          </span>
        </div>

        <div className="hd-rule" style={{ marginTop: 12, marginBottom: 6 }}>
          <span className="tiny dim">run usage · state.json</span>
          <span className="line" />
        </div>

        <div className="man-row">
          <span className="lbl">model / tool calls</span>
          <span className="val">
            {stats.modelCalls} <span className="dim">/</span> {stats.toolCalls}
          </span>
        </div>
        <div className="man-row">
          <span className="lbl">tokens in / out</span>
          <span className="val">
            {fmtK(stats.inputTokens)} <span className="dim">/</span> {fmtK(stats.outputTokens)}
          </span>
        </div>
        <div className="man-row">
          <span className="lbl">errors</span>
          <span className="val" style={{ color: stats.errors > 0 ? "var(--bad)" : "var(--text)" }}>
            {stats.errors}
          </span>
        </div>

        <div className="hd-rule" style={{ marginTop: 12, marginBottom: 6 }}>
          <span className="tiny dim">paid-usage disclosure</span>
          <span className="line" />
        </div>

        <div className="stack" style={{ gap: 6 }}>
          {flags.map(([k, v]) => (
            <div key={k} className="row between" style={{ padding: "5px 0" }}>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-mute)" }}>
                {k}
              </span>
              <span className={`pill ${v ? "pill-bad" : "pill-ok"}`}>
                <span className="dot" />
                {v ? "YES" : "NO"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- FINAL REPORT ----------

type Block =
  | { t: "h1"; v: string }
  | { t: "h2"; v: string }
  | { t: "p"; v: string }
  | { t: "ul"; v: string[] };

function renderInline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let m: RegExpExecArray | null = re.exec(s);
  while (m !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<b key={key++}>{tok.slice(2, -2)}</b>);
    }
    last = m.index + tok.length;
    m = re.exec(s);
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function parseMarkdown(report: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const line of report.split("\n")) {
    if (line.startsWith("# ")) {
      flush();
      blocks.push({ t: "h1", v: line.slice(2) });
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ t: "h2", v: line.slice(3) });
    } else if (line.startsWith("- ")) {
      if (!cur || cur.t !== "ul") {
        flush();
        cur = { t: "ul", v: [] };
      }
      cur.v.push(line.slice(2));
    } else if (line.trim() === "") {
      flush();
    } else {
      if (!cur || cur.t !== "p") {
        flush();
        cur = { t: "p", v: "" };
      }
      cur.v += (cur.v ? " " : "") + line;
    }
  }
  flush();
  return blocks;
}

export function FinalReport({
  report,
  runDone,
  onRegenerate,
}: {
  report: string | null;
  runDone: boolean;
  onRegenerate: () => void;
}) {
  const toast = useToast();
  const blocks = useMemo(() => (report ? parseMarkdown(report) : []), [report]);

  return (
    <div className="card col-12">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="doc" size={12} /> Final report · final_report.md
        </span>
        <div className="row" style={{ gap: 6 }}>
          {report ? (
            <span className="pill pill-ok">
              <span className="dot" />
              ready
            </span>
          ) : (
            <span className="pill pill-warn">
              <span className="dot" />
              pending
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={onRegenerate}>
            <Icon name="refresh" size={12} /> {report ? "Regenerate" : "Generate"}
          </button>
          {report && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(report);
                toast({ type: "info", title: "Report copied" });
              }}
            >
              <Icon name="copy" size={12} /> Copy
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        {report ? (
          <div className="report">
            {blocks.map((b, i) => {
              if (b.t === "h1") return <h1 key={i}>{renderInline(b.v)}</h1>;
              if (b.t === "h2") return <h2 key={i}>{renderInline(b.v)}</h2>;
              if (b.t === "p") return <p key={i}>{renderInline(b.v)}</p>;
              return (
                <ul key={i}>
                  {b.v.map((li, j) => (
                    <li key={j}>{renderInline(li)}</li>
                  ))}
                </ul>
              );
            })}
          </div>
        ) : (
          <div className="empty" style={{ padding: 30 }}>
            <div className="ic">📋</div>
            <div>Run is {runDone ? "complete" : "in progress"} — final report not yet generated.</div>
            <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
              Pulls from score progression, decisions.log, interventions, and workspace state.
            </div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={onRegenerate}>
              <Icon name="refresh" size={12} /> Generate now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
