import type {
  AgentSnapshot,
  ControlAction,
  InterventionInput,
  Phase,
  PromptResult,
} from "@needle-agent/api/agent/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentChat } from "@/components/operator/agent-chat";
import { MissionControl } from "@/components/operator/mission-control";
import { StatusBar } from "@/components/operator/panels-top";
import { ToastProvider, useToast } from "@/components/operator/toast";
import { orpc } from "@/utils/orpc";

import "@/components/operator/operator.css";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  head: () => ({
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
});

function RouteComponent() {
  return (
    <div className="op-shell">
      <ToastProvider>
        <OperatorConsole />
      </ToastProvider>
    </div>
  );
}

interface SnapshotMarker {
  phase: Phase | null;
  scores: number;
  errors: number;
  stuck: boolean;
}

function OperatorConsole() {
  const toast = useToast();
  const queryClient = useQueryClient();

  // Which run we're viewing — undefined = the live run; an id = an archived session.
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);

  // The single source of truth — polled from the server, which reads the
  // agent's real .needle-agent/ artifacts on every request. Archived sessions
  // are frozen history, so they are fetched once rather than polled.
  const snapshotOpts = orpc.agent.snapshot.queryOptions({ input: { sessionId: selectedSessionId } });
  const query = useQuery({ ...snapshotOpts, refetchInterval: selectedSessionId ? false : 2500 });
  const sessionsQuery = useQuery({ ...orpc.agent.listSessions.queryOptions(), refetchInterval: 8000 });
  const sessions = sessionsQuery.data ?? [];

  const [view, setView] = useState<"mission" | "chat">("mission");
  const [chatUnread, setChatUnread] = useState(0);

  const setSnapshot = useCallback(
    (snap: AgentSnapshot) => queryClient.setQueryData(snapshotOpts.queryKey, snap),
    [queryClient, snapshotOpts.queryKey],
  );

  const controlMut = useMutation({
    ...orpc.agent.control.mutationOptions(),
    onSuccess: setSnapshot,
  });
  const interventionMut = useMutation({
    ...orpc.agent.logIntervention.mutationOptions(),
    onSuccess: setSnapshot,
  });
  const regenerateMut = useMutation({
    ...orpc.agent.regenerateReport.mutationOptions(),
    onSuccess: setSnapshot,
  });
  const promptMut = useMutation(orpc.agent.sendPrompt.mutationOptions());

  // Data-driven toasts: fire only when the real polled snapshot actually
  // changes (new test run, phase transition, regression, stuck, error).
  const snapshot = query.data;
  const marker = useRef<SnapshotMarker | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    // Archived sessions are static history — don't fire live-event toasts.
    if (selectedSessionId) {
      marker.current = null;
      return;
    }
    const cur: SnapshotMarker = {
      phase: snapshot.run.phase,
      scores: snapshot.scores.length,
      errors: snapshot.stats.errors,
      stuck: snapshot.run.stuck,
    };
    const last = marker.current;
    marker.current = cur;
    if (!last) return; // first load — no toast spam

    if (cur.scores > last.scores) {
      const latest = snapshot.scores[snapshot.scores.length - 1]!;
      const before = snapshot.scores[snapshot.scores.length - 2];
      const delta = before ? latest.score - before.score : 0;
      if (latest.regressed) {
        toast({
          type: "bad",
          title: "Regression detected",
          sub: `score ${before?.score ?? "?"} → ${latest.score} at iter ${latest.iter}`,
        });
      } else {
        toast({
          type: "info",
          title: "New test run completed",
          sub: `iter ${latest.iter} · ${latest.score}/${latest.total}${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`,
        });
      }
    }
    if (cur.phase !== last.phase) {
      if (cur.phase === "DONE") {
        toast({ type: "ok", title: "Run complete", sub: "agent reached the DONE phase" });
      } else if (cur.phase === "FAILED") {
        toast({ type: "bad", title: "Run failed", sub: "check errors.log for details" });
      } else if (cur.phase) {
        toast({ type: "info", title: `Phase: ${cur.phase}` });
      }
    }
    if (cur.stuck && !last.stuck) {
      toast({ type: "warn", title: "Agent stuck", sub: "no score change for 3+ iterations" });
    }
    if (cur.errors > last.errors) {
      toast({ type: "bad", title: "Agent error logged", sub: `${cur.errors} total this run` });
    }
  }, [snapshot, toast, selectedSessionId]);

  const onAction = useCallback(
    async (action: ControlAction) => {
      try {
        await controlMut.mutateAsync({ action });
        if (action === "start") {
          toast({ type: "ok", title: "Agent started", sub: "spawned agent process · fresh run" });
        } else if (action === "pause") {
          toast({ type: "warn", title: "Agent paused", sub: "SIGSTOP sent to the run" });
        } else if (action === "resume") {
          toast({ type: "ok", title: "Agent resumed", sub: "SIGCONT sent to the run" });
        } else if (action === "continue") {
          toast({ type: "ok", title: "Run resumed", sub: "relaunched the agent from its checkpoint" });
        } else {
          toast({ type: "bad", title: "Agent stopped", sub: "SIGTERM sent · partial results saved" });
        }
      } catch {
        toast({ type: "bad", title: "Action failed", sub: "could not reach the agent server" });
      }
    },
    [controlMut, toast],
  );

  const onViewChange = useCallback((next: "mission" | "chat") => {
    setView(next);
    if (next === "chat") setChatUnread(0);
  }, []);

  const onLogIntervention = useCallback(
    async (entry: InterventionInput) => {
      await interventionMut.mutateAsync(entry);
      toast({
        type: entry.touched ? "warn" : "ok",
        title: "Intervention logged",
        sub: "appended to human_interventions.log",
      });
    },
    [interventionMut, toast],
  );

  const onRegenerateReport = useCallback(() => {
    toast({ type: "info", title: "Regenerating final report…", sub: "compiling from real run data" });
    regenerateMut.mutate(undefined, {
      onSuccess: () => toast({ type: "ok", title: "Final report generated", sub: "final_report.md written" }),
      onError: () => toast({ type: "bad", title: "Report generation failed" }),
    });
  }, [regenerateMut, toast]);

  const onSendPrompt = useCallback(
    async (text: string, intervention: boolean): Promise<PromptResult> => {
      const res = await promptMut.mutateAsync({ text, intervention });
      setSnapshot(res.snapshot);
      toast({
        type: intervention ? "warn" : "info",
        title: "Prompt sent to agent",
        sub: intervention
          ? "logged to prompts.log + human_interventions.log"
          : "logged to prompts.log",
      });
      if (view !== "chat") setChatUnread((n) => n + 1);
      return res.result;
    },
    [promptMut, setSnapshot, toast, view],
  );

  if (query.isLoading || !query.data) {
    return (
      <div className="empty" style={{ margin: "auto", maxWidth: 360 }}>
        <div className="ic">◴</div>
        {query.isError ? "Could not reach the agent server." : "Connecting to the agent server…"}
        <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
          {query.isError ? "Start the server with `bun dev` and retry." : "GET /rpc · agent.snapshot"}
        </div>
      </div>
    );
  }

  const snap = query.data;

  return (
    <>
      <StatusBar
        run={snap.run}
        deadline={snap.deadline}
        dataUpdatedAt={query.dataUpdatedAt}
        view={view}
        onViewChange={onViewChange}
        chatUnread={chatUnread}
        onAction={onAction}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
      />

      {view === "chat" ? (
        <AgentChat run={snap.run} snapshot={snap} onSendPrompt={onSendPrompt} />
      ) : (
        <MissionControl
          snapshot={snap}
          onLogIntervention={onLogIntervention}
          onRegenerateReport={onRegenerateReport}
        />
      )}
    </>
  );
}
