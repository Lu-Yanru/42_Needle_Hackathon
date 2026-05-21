import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: (process.env.DATABASE_URL || "local.db").replace(/^file:/, ""),
  },
});
