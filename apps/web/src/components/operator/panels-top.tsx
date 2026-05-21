// Top-row panels: StatusBar, ScoreChart, FailingCategories, SubmissionChecklist.

import type { ChecklistItem, ControlAction, RunState, RunStats, ScorePoint } from "@needle-agent/api/agent/types";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatCountdown, formatElapsed, formatRelativeMs, useTicker } from "./format";
import { Icon } from "./icons";

// Fixed mission-control palette (no accent theming — dark mode only).
const C = {
  accent: "#7c5cff",
  line: "rgba(255,255,255,0.06)",
  bg: "#07090d",
  bad: "#f87171",
};

const PHASES = ["PLANNING", "GENERATE_TESTS", "IMPLEMENTING", "TESTING", "FIXING", "DONE"] as const;

/** Compact thousands formatting for token counts. */
function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ---------- STATUS BAR ----------

interface StatusBarProps {
  run: RunState;
  stats: RunStats;
  deadline: string;
  /** Epoch ms of the last successful poll, for the "last update" tooltip. */
  dataUpdatedAt: number;
  view: "mission" | "chat";
  onViewChange: (v: "mission" | "chat") => void;
  chatUnread: number;
  onAction: (action: ControlAction) => void;
}

export function StatusBar({
  run,
  stats,
  deadline,
  dataUpdatedAt,
  view,
  onViewChange,
  chatUnread,
  onAction,
}: StatusBarProps) {
  // Tick every second so elapsed + countdown stay live.
  useTicker(1000);
  const now = Date.now();
  // Freeze elapsed once the run finishes, instead of counting up forever.
  const endRef = run.completedAt ? new Date(run.completedAt).getTime() : now;
  const elapsed = run.startedAt ? endRef - new Date(run.startedAt).getTime() : null;
  const remainingMs = new Date(deadline).getTime() - now;
  const urgent = remainingMs < 30 * 60 * 1000;
  const overdue = remainingMs < 0;

  const activeIdx = run.phase ? PHASES.indexOf(run.phase as (typeof PHASES)[number]) : -1;

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="brand-name">
              Needle <span className="dim" style={{ fontWeight: 400 }}>·</span> Operator
            </div>
            <div className="brand-sub">42 Berlin Hackathon</div>
          </div>
        </div>

        <div className="view-tabs" role="tablist">
          <button
            type="button"
            className={`view-tab ${view === "mission" ? "active" : ""}`}
            onClick={() => onViewChange("mission")}
            role="tab"
            aria-selected={view === "mission"}
          >
            <Icon name="cpu" size={12} /> Mission control
          </button>
          <button
            type="button"
            className={`view-tab ${view === "chat" ? "active" : ""}`}
            onClick={() => onViewChange("chat")}
            role="tab"
            aria-selected={view === "chat"}
          >
            <Icon name="send" size={12} /> Prompt agent
            {chatUnread > 0 && <span className="vt-badge">{chatUnread}</span>}
          </button>
        </div>

        <div className="topbar-mid">
          {!run.phase ? (
            <div className="dim mono" style={{ fontSize: 11 }}>
              NO ACTIVE RUN
            </div>
          ) : run.phase === "FAILED" ? (
            <div className="mono" style={{ fontSize: 11, color: "var(--bad)", fontWeight: 600 }}>
              ⚠ RUN FAILED
            </div>
          ) : (
            <div className="stepper">
              {PHASES.map((p, i) => {
                const isDone = i < activeIdx || (run.phase === "DONE" && i <= activeIdx);
                const isActive = i === activeIdx && run.phase !== "DONE";
                const cls = isActive ? "active" : isDone ? "done" : "";
                return (
                  <div key={p} className={`step ${cls}`}>
                    <span className="step-dot" />
                    <span>{p === "GENERATE_TESTS" ? "GEN TESTS" : p}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="meta-sep" />

          <div className="meta-group">
            <div>
              <span className="lab">ITER</span>{" "}
              <span className="val">
                {run.iteration} <span className="dim">/ {run.maxIterations}</span>
              </span>
            </div>
            <div>
              <span className="lab">ELAPSED</span> <span className="val">{formatElapsed(elapsed)}</span>
            </div>
            <div>
              <span className="lab">CALLS</span>{" "}
              <span className="val">
                {stats.modelCalls}
                <span className="dim">m</span> {stats.toolCalls}
                <span className="dim">t</span>
              </span>
            </div>
            <div>
              <span className="lab">TOKENS</span>{" "}
              <span className="val">{fmtK(stats.inputTokens + stats.outputTokens)}</span>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <span
            className="live-ind"
            title={`Polling every 2.5s · last update ${formatRelativeMs(now - dataUpdatedAt)}`}
          >
            <span className="live-dot" />
            <span className="dim">live</span>
          </span>

          <div className="run-controls">
            {run.running && !run.paused && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => onAction("pause")}>
                  <Icon name="pause" /> Pause
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onAction("stop")}>
                  <Icon name="stop" /> Stop
                </button>
              </>
            )}
            {run.running && run.paused && (
              <>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onAction("resume")}>
                  <Icon name="play" /> Resume
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onAction("stop")}>
                  <Icon name="stop" /> Stop
                </button>
              </>
            )}
            {!run.running && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onAction("start")}>
                <Icon name="play" /> Start run
              </button>
            )}
          </div>

          <div className={`deadline ${urgent ? "urgent" : ""}`} title="Friday 12:00 submission deadline">
            <span className="l">submission in</span>
            <span className="v">{overdue ? "OVERDUE" : formatCountdown(remainingMs)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- SCORE CHART ----------

interface TooltipEntry {
  payload: { iter: number; score: number; timestamp: string; regressed: boolean };
}

interface TooltipRenderProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
}

export function ScoreChart({ scores }: { scores: ScorePoint[] }) {
  const latest = scores.length ? scores[scores.length - 1] : null;
  const prev = scores.length > 1 ? scores[scores.length - 2] : null;
  const delta = latest && prev ? latest.score - prev.score : 0;
  const regressions = scores.filter((s) => s.regressed).length;
  const peak = scores.reduce((m, s) => Math.max(m, s.score), 0);
  const pct = latest ? Math.round((latest.score / latest.total) * 100) : 0;
  const avgGain = latest && scores.length > 1 ? ((latest.score - scores[0]!.score) / (scores.length - 1)).toFixed(1) : "—";

  if (!latest) {
    return (
      <div className="card col-8">
        <div className="card-hd">
          <span className="card-hd-title">Score progression</span>
          <span className="card-hd-meta">no data</span>
        </div>
        <div className="empty">
          <div className="ic">○</div>
          No test runs yet. Press <span className="kbd">Start run</span> to begin the loop.
        </div>
      </div>
    );
  }

  const data = scores.map((s) => ({
    iter: s.iter,
    score: s.score,
    timestamp: s.timestamp,
    regressed: s.regressed,
  }));

  return (
    <div className="card col-8">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="up" size={12} /> Score progression · public suite
        </span>
        <span className="card-hd-meta">
          {scores.length} iterations · last update {latest.timestamp}
        </span>
      </div>

      <div className="score-hero">
        <div>
          <div className="score-number">
            <span className="big">{latest.score}</span>
            <span className="of">/ {latest.total}</span>
            <span
              className={`score-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}
              style={{ marginLeft: 8 }}
            >
              <Icon name={delta > 0 ? "up" : delta < 0 ? "down" : "circle"} size={11} />
              {delta > 0 ? "+" : ""}
              {delta} vs prev
            </span>
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>
            {pct}% passing
          </div>
        </div>

        <div className="score-stats">
          <div className="item">
            <span className="l">Peak</span>
            <span className="v">{peak}</span>
          </div>
          <div className="item">
            <span className="l">Avg gain / iter</span>
            <span className="v">{avgGain}</span>
          </div>
          <div className="item">
            <span className="l">Regressions</span>
            <span className="v" style={{ color: regressions ? "var(--bad)" : "var(--text)" }}>
              {regressions}
            </span>
          </div>
          <div className="item">
            <span className="l">Iterations</span>
            <span className="v">{scores.length}</span>
          </div>
        </div>
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 12 }}>
            <defs>
              <linearGradient id="op-score-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity={0.5} />
                <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="iter" tickLine={false} axisLine={{ stroke: C.line }} tickFormatter={(v) => `i${v}`} />
            <YAxis domain={[0, latest.total]} tickLine={false} axisLine={{ stroke: C.line }} width={36} />
            <Tooltip
              cursor={{ stroke: C.accent, strokeWidth: 1, strokeDasharray: "3 3" }}
              content={(props) => {
                const { active, payload } = props as unknown as TooltipRenderProps;
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]!.payload;
                return (
                  <div
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--line-strong)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ color: "var(--text-mute)", fontSize: 10 }}>{d.timestamp}</div>
                    <div style={{ color: "var(--text)", marginTop: 2 }}>
                      iter {d.iter}: <b>{d.score}</b> / {latest.total}
                    </div>
                    {d.regressed && (
                      <div style={{ color: "var(--bad)", marginTop: 2 }}>⚠ regression detected</div>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke={C.accent}
              strokeWidth={2.5}
              fill="url(#op-score-fill)"
              dot={{ r: 2.5, fill: C.accent, stroke: C.accent, strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: C.accent, strokeWidth: 2, fill: C.bg }}
              isAnimationActive={false}
            />
            {data
              .filter((d) => d.regressed)
              .map((d) => (
                <ReferenceDot key={d.iter} x={d.iter} y={d.score} r={5} fill={C.bad} stroke={C.bg} strokeWidth={2} />
              ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- FAILING CATEGORIES ----------

export function FailingCategories({ scores }: { scores: ScorePoint[] }) {
  const latest = scores.length ? scores[scores.length - 1]! : null;
  const prev = scores.length > 1 ? scores[scores.length - 2]! : null;

  if (!latest) {
    return (
      <div className="card col-4">
        <div className="card-hd">
          <span className="card-hd-title">Failing categories</span>
        </div>
        <div className="empty">
          <div className="ic">○</div>No data yet
        </div>
      </div>
    );
  }

  const cats = latest.failingCategories;
  const prevMap = new Map((prev?.failingCategories ?? []).map((c) => [c.name, c.count]));
  const total = cats.reduce((s, c) => s + c.count, 0);
  const max = Math.max(...cats.map((c) => c.count), 1);

  return (
    <div className="card col-4">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="alert" size={12} /> Failing categories
        </span>
        <span className="card-hd-meta">
          {total} failing · iter {latest.iter}
        </span>
      </div>
      <div className="card-body">
        {cats.length === 0 && <div className="empty">All passing 🎯</div>}
        {cats.map((c) => {
          const prevCount = prevMap.get(c.name);
          let trendCls = "flat";
          let trendText = "—";
          if (prevCount == null) {
            trendCls = "new";
            trendText = "NEW";
          } else if (c.count < prevCount) {
            trendCls = "up";
            trendText = `↑ −${prevCount - c.count}`;
          } else if (c.count > prevCount) {
            trendCls = "down";
            trendText = `↓ +${c.count - prevCount}`;
          }
          return (
            <div className="fc-row" key={c.name}>
              <div>
                <div className="fc-name mono">{c.name}</div>
                <div className="fc-bar" style={{ marginTop: 4 }}>
                  <div style={{ width: `${(c.count / max) * 100}%` }} />
                </div>
              </div>
              <span className="fc-count">{c.count}</span>
              <span className={`fc-trend ${trendCls}`}>{trendText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- SUBMISSION CHECKLIST ----------

export function SubmissionChecklist({ checklist }: { checklist: ChecklistItem[] }) {
  const okCount = checklist.filter((c) => c.ok).length;
  const allOk = okCount === checklist.length;
  return (
    <div className="card col-4">
      <div className="card-hd">
        <span className="card-hd-title">
          <Icon name="check" size={12} /> Submission readiness
        </span>
        <span className={`pill ${allOk ? "pill-ok" : "pill-warn"}`}>
          <span className="dot" />
          {okCount} / {checklist.length}
        </span>
      </div>
      <div className="card-body">
        {checklist.map((c) => (
          <div className="chk-row" key={c.label}>
            <div className={`chk-box ${c.ok ? "ok" : c.warn ? "warn" : "bad"}`}>
              {c.ok ? "✓" : c.warn ? "!" : "✕"}
            </div>
            <div className="chk-label">{c.label}</div>
            <div className="chk-meta">{c.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
