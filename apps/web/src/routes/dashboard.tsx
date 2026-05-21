import type {
  AgentSnapshot,
  ControlAction,
  InterventionInput,
  PromptResult,
  Scenario,
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

function OperatorConsole() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const snapshotOpts = orpc.agent.snapshot.queryOptions();
  const query = useQuery({ ...snapshotOpts, refetchInterval: 2500 });

  const [view, setView] = useState<"mission" | "chat">("mission");
  const [chatUnread, setChatUnread] = useState(0);
  const prevScenario = useRef<Scenario | null>(null);

  const setSnapshot = useCallback(
    (snap: AgentSnapshot) => queryClient.setQueryData(snapshotOpts.queryKey, snap),
    [queryClient, snapshotOpts.queryKey],
  );

  const controlMut = useMutation({
    ...orpc.agent.control.mutationOptions(),
    onSuccess: setSnapshot,
  });
  const scenarioMut = useMutation({
    ...orpc.agent.setScenario.mutationOptions(),
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

  // Demo toasts when the scenario changes — showcases the brief's required
  // toast types (new run / stuck / regression / complete).
  const scenario = query.data?.scenario;
  useEffect(() => {
    if (!scenario) return;
    if (prevScenario.current === scenario) return;
    const first = prevScenario.current === null;
    prevScenario.current = scenario;
    if (first) return;
    if (scenario === "climbing") {
      setTimeout(() => toast({ type: "info", title: "New test run completed", sub: "iter 22 · 137/250 (+5)" }), 700);
    } else if (scenario === "stuck") {
      setTimeout(() => toast({ type: "warn", title: "Agent stuck", sub: "no score change for 3 iterations" }), 600);
      setTimeout(() => toast({ type: "bad", title: "Regression detected", sub: "score 108 → 104 at iter 13" }), 1700);
    } else if (scenario === "done") {
      setTimeout(() => toast({ type: "ok", title: "Run complete", sub: "189/250 · final_report.md generated" }), 700);
    }
  }, [scenario, toast]);

  const onAction = useCallback(
    async (action: ControlAction) => {
      try {
        await controlMut.mutateAsync({ action });
        if (action === "start") toast({ type: "ok", title: "Run started", sub: "PLANNING phase · iter 0" });
        else if (action === "pause") toast({ type: "warn", title: "Run paused" });
        else if (action === "resume") toast({ type: "ok", title: "Run resumed" });
        else toast({ type: "bad", title: "Run stopped", sub: "manual STOP — partial results saved" });
      } catch {
        toast({ type: "bad", title: "Action failed", sub: "could not reach the agent server" });
      }
    },
    [controlMut, toast],
  );

  const onScenarioChange = useCallback(
    (next: Scenario) => {
      scenarioMut.mutate({ scenario: next });
    },
    [scenarioMut],
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
    toast({ type: "info", title: "Regenerating final report…", sub: "compiling from logs + score history" });
    regenerateMut.mutate(undefined, {
      onSuccess: () => toast({ type: "ok", title: "Final report generated", sub: "final_report.md updated" }),
    });
  }, [regenerateMut, toast]);

  const onSendPrompt = useCallback(
    async (text: string, intervention: boolean): Promise<PromptResult> => {
      const res = await promptMut.mutateAsync({ text, intervention });
      setSnapshot(res.snapshot);
      toast({
        type: intervention ? "warn" : "info",
        title: "Prompt sent to agent",
        sub: intervention ? "logged to prompts.log + human_interventions.log" : "logged to prompts.log only",
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

  const snapshot = query.data;

  return (
    <>
      <StatusBar
        run={snapshot.run}
        deadline={snapshot.deadline}
        dataUpdatedAt={query.dataUpdatedAt}
        view={view}
        onViewChange={onViewChange}
        chatUnread={chatUnread}
        scenario={snapshot.scenario}
        onScenarioChange={onScenarioChange}
        onAction={onAction}
      />

      {view === "chat" ? (
        <AgentChat run={snapshot.run} snapshot={snapshot} onSendPrompt={onSendPrompt} />
      ) : (
        <MissionControl
          snapshot={snapshot}
          onLogIntervention={onLogIntervention}
          onRegenerateReport={onRegenerateReport}
        />
      )}
    </>
  );
}
