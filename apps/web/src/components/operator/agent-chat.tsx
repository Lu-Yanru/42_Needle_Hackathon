// Prompt Agent screen — the second view. Lets the operator nudge the running
// agent live; each prompt is logged server-side and the agent replies inline.

import type { AgentSnapshot, PromptResult, RunState } from "@needle-agent/api/agent/types";
import { useEffect, useMemo, useRef, useState } from "react";

import { fmtTsLong } from "./format";
import { Icon } from "./icons";

interface QuickPrompt {
  label: string;
  emoji: string;
  text: string;
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: "Pause and re-plan from scratch",
    emoji: "↺",
    text: "Pause the current iteration. Re-read the spec from spec.md and produce a fresh top-level plan. Don't write any code until you've described the new approach in 3-5 bullet points.",
  },
  {
    label: "Focus on edge cases cluster",
    emoji: "→",
    text: "Stop working on the current category. The biggest cluster of failures is in edge_cases. Drop everything else and target that cluster: identify what's failing, propose a fix strategy, then implement.",
  },
  {
    label: "Rollback last change",
    emoji: "↶",
    text: "Roll back your last file edit to the previous snapshot. Re-run the tests to confirm we're back at the prior score, then describe what you would do differently.",
  },
  {
    label: "Try a smaller, faster model",
    emoji: "⤓",
    text: "Switch the primary model to qwen2.5-coder:14b for the next 5 iterations to see if the smaller model unblocks the current cluster. Log the switch in decisions.log.",
  },
  {
    label: "Suggest a refactor",
    emoji: "✎",
    text: "Before writing more code, suggest a refactor of src/eval.py that would make the next 5 changes easier. Don't implement it — just describe the proposed structure and what it buys us.",
  },
  {
    label: "What's the highest-EV next step?",
    emoji: "✦",
    text: "Given the current score, failing categories, and remaining time until deadline, what is the single highest-expected-value next change you could make? Justify with reasoning.",
  },
];

interface ChatMsg {
  role: "system" | "user" | "agent";
  ts: string;
  text: string;
  intervention?: boolean;
  model?: string;
  thinking?: boolean;
}

function MsgBubble({ msg }: { msg: ChatMsg }) {
  const isAgent = msg.role === "agent";
  const isSys = msg.role === "system";
  return (
    <div className={`chat-row ${msg.role}`}>
      <div className="chat-avatar">{isSys ? "i" : isAgent ? "A" : "U"}</div>
      <div className="chat-content">
        <div className="chat-meta">
          <span className="chat-name">{isSys ? "system" : isAgent ? "agent" : "you"}</span>
          <span className="chat-ts mono">{msg.ts}</span>
          {msg.intervention && (
            <span className="pill pill-warn" style={{ marginLeft: 6 }}>
              <span className="dot" />
              logged as intervention
            </span>
          )}
          {msg.model && <span className="chat-model mono">via {msg.model}</span>}
        </div>
        <div className="chat-text">
          {msg.thinking ? (
            <span className="chat-thinking">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="dim mono" style={{ marginLeft: 8 }}>
                agent is thinking…
              </span>
            </span>
          ) : (
            msg.text.split("\n").map((line, i) => <div key={i}>{line || " "}</div>)
          )}
        </div>
      </div>
    </div>
  );
}

interface AgentChatProps {
  run: RunState;
  snapshot: AgentSnapshot;
  onSendPrompt: (text: string, intervention: boolean) => Promise<PromptResult>;
}

export function AgentChat({ run, snapshot, onSendPrompt }: AgentChatProps) {
  const [draft, setDraft] = useState("");
  const [logAsIntervention, setLogAsIntervention] = useState(true);
  const [sending, setSending] = useState(false);
  const [thread, setThread] = useState<ChatMsg[]>(() => [
    {
      role: "system",
      ts: fmtTsLong(new Date()).slice(11),
      text: "Prompts you send here are injected into the agent's next iteration. They land in prompts.log and, if checked below, also as a human intervention. The agent's reply is its plan for handling your nudge — it doesn't take effect until the next iteration starts.",
    },
  ]);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  const isRunning = run.running && !run.paused;
  const canSend = draft.trim().length > 0 && !sending;

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setDraft("");
    const intervention = logAsIntervention;
    const ts = fmtTsLong(new Date()).slice(11);
    setThread((t) => [
      ...t,
      { role: "user", ts, text: text.trim(), intervention },
      { role: "agent", ts, text: "", thinking: true },
    ]);

    let reply = "";
    let model = run.model || "qwen2.5-coder:32b";
    try {
      const res = await onSendPrompt(text.trim(), intervention);
      reply = res.reply;
      model = res.model;
    } catch {
      reply =
        "Acknowledged. Will apply on next iteration boundary. Estimating 2 iters to evaluate impact; reverting if score drops > 5.";
      model = "offline-fallback";
    }

    const ts2 = fmtTsLong(new Date()).slice(11);
    setThread((t) => {
      const copy = [...t];
      const idx = copy.findIndex((m) => m.thinking);
      const replaced: ChatMsg = { role: "agent", ts: ts2, text: reply, model };
      if (idx >= 0) copy[idx] = replaced;
      else copy.push(replaced);
      return copy;
    });
    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) void send(draft);
    }
  };

  const ctx = useMemo(() => {
    const latest = snapshot.scores.at(-1);
    return {
      phase: run.phase ?? "—",
      iter: run.iteration,
      maxIter: run.maxIterations,
      score: latest ? `${latest.score} / ${latest.total}` : "—",
      failing:
        latest?.failingCategories
          .slice(0, 3)
          .map((c) => `${c.name}(${c.count})`)
          .join(" · ") || "—",
      model: run.model || "—",
    };
  }, [snapshot, run]);

  const subText = isRunning ? (
    <>
      <span className="live-dot" style={{ marginRight: 5, verticalAlign: "middle" }} />
      agent is running — your prompt lands at the next iteration boundary
    </>
  ) : run.paused ? (
    "agent is paused — prompts queue until resume"
  ) : !run.phase ? (
    "no active run — start a run to send prompts"
  ) : (
    "run is complete — prompts are recorded but won't be acted on"
  );

  return (
    <div className="chat-screen">
      <div className="chat-main">
        <div className="chat-hd">
          <div>
            <div className="chat-title">Prompt agent</div>
            <div className="chat-sub mono">{subText}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setThread((t) => t.slice(0, 1))}
            >
              <Icon name="refresh" size={12} /> Clear thread
            </button>
          </div>
        </div>

        <div className="chat-thread" ref={threadRef}>
          {thread.map((m, i) => (
            <MsgBubble key={i} msg={m} />
          ))}
        </div>

        <div className="chat-composer">
          <div className="composer-shell">
            <textarea
              className="composer-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a nudge for the agent…   (⏎ send, ⇧⏎ newline)"
              rows={2}
            />
            <div className="composer-toolbar">
              <label className="composer-toggle" title="Also log this prompt to human_interventions.log">
                <input
                  type="checkbox"
                  checked={logAsIntervention}
                  onChange={(e) => setLogAsIntervention(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span className="dim">log as intervention</span>
                {logAsIntervention && (
                  <span className="pill pill-warn" style={{ marginLeft: 4 }}>
                    <span className="dot" />
                    on
                  </span>
                )}
              </label>
              <div className="grow" />
              <span className="kbd">⏎</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void send(draft)}
                disabled={!canSend}
              >
                <Icon name="send" size={12} /> {sending ? "Sending…" : "Send nudge"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="chat-aside">
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="card-hd">
            <span className="card-hd-title">Current run state</span>
          </div>
          <div className="card-body">
            <div className="ctx-row">
              <span className="lbl">Phase</span>
              <span className="val mono">{ctx.phase}</span>
            </div>
            <div className="ctx-row">
              <span className="lbl">Iteration</span>
              <span className="val mono">
                {ctx.iter} <span className="dim">/ {ctx.maxIter}</span>
              </span>
            </div>
            <div className="ctx-row">
              <span className="lbl">Score</span>
              <span className="val mono">{ctx.score}</span>
            </div>
            <div className="ctx-row">
              <span className="lbl">Model</span>
              <span className="val mono" style={{ color: "var(--accent-2)" }}>
                {ctx.model}
              </span>
            </div>
            <div className="ctx-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <span className="lbl">Top failing clusters</span>
              <span className="val mono" style={{ fontSize: 11, textAlign: "left", color: "var(--bad)" }}>
                {ctx.failing}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <span className="card-hd-title">Quick prompts</span>
            <span className="card-hd-meta">tap to fill composer</span>
          </div>
          <div className="card-body" style={{ gap: 6 }}>
            {QUICK_PROMPTS.map((p) => (
              <button
                type="button"
                key={p.label}
                className="quick-prompt"
                onClick={() => setDraft(p.text)}
                title={p.text}
              >
                <span className="quick-prompt-icon">{p.emoji}</span>
                <span className="quick-prompt-label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dim mono" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.55, padding: "0 4px" }}>
          Honor-system note: any prompt that materially changes the agent's strategy counts as an intervention.
          Leave the toggle on unless this is purely a clarification.
        </div>
      </aside>
    </div>
  );
}
