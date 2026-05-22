// Full-RunState checkpoint persistence — the file that powers `--resume`.
//
// Distinct from state.json (a small display snapshot for the dashboard):
// checkpoint.json captures everything the loop needs to continue a stopped
// run — the plan, self-tests, verification cursor, and the rollback snapshot.

import { join } from "node:path";
import type { RunState } from "./state";

const FILE = "checkpoint.json";

/** RunState reshaped for JSON — the one Map field becomes a plain object. */
type SerializedCheckpoint = Omit<RunState, "lastGoodSnapshot"> & {
  lastGoodSnapshot: Record<string, string> | null;
};

/** Write the full run state to `<dir>/checkpoint.json`. */
export async function writeCheckpoint(dir: string, state: RunState): Promise<void> {
  const serial: SerializedCheckpoint = {
    ...state,
    lastGoodSnapshot: state.lastGoodSnapshot
      ? Object.fromEntries(state.lastGoodSnapshot)
      : null,
  };
  await Bun.write(join(dir, FILE), `${JSON.stringify(serial, null, 2)}\n`);
}

/** Load a run state from `<dir>/checkpoint.json`; null if absent or unreadable. */
export async function loadCheckpoint(dir: string): Promise<RunState | null> {
  const file = Bun.file(join(dir, FILE));
  if (!(await file.exists())) return null;
  let serial: SerializedCheckpoint;
  try {
    serial = (await file.json()) as SerializedCheckpoint;
  } catch {
    return null;
  }
  return {
    ...serial,
    lastGoodSnapshot: serial.lastGoodSnapshot
      ? new Map(Object.entries(serial.lastGoodSnapshot))
      : null,
  };
}
