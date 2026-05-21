/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { env } from "@needle-agent/env/server";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export function createDb() {
  const sqlite = new Database(env.DATABASE_URL.replace(/^file:/, ""), {
    create: true,
  });

  return drizzle({ client: sqlite, schema });
}

export const db = createDb();
