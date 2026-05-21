// Time + formatting helpers for the Operator Console.

import { useEffect, useState } from "react";

/** "1h 04m 09s" / "12m 30s" — elapsed run time. */
export function formatElapsed(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** "just now" / "12s ago" / "4m ago" — freshness of the last poll. */
export function formatRelativeMs(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** "HH:MM:SS" — submission countdown. */
export function formatCountdown(ms: number): string {
  if (ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:MM:SS" of a Date. */
export function fmtTsLong(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Today's date as "YYYY-MM-DD". */
export function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Force a re-render on an interval so live timers (elapsed, countdown) tick. */
export function useTicker(intervalMs = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
