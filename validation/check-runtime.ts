/** Isolated release preflight: never opens the production database. */
import { Database } from "@db/sqlite";

const path = Deno.env.get("DENO_SQLITE_PATH");
if (!path) {
  throw new Error("DENO_SQLITE_PATH must select the verified test library");
}
const db = new Database(":memory:");
try {
  const row = db.prepare("SELECT sqlite_version() AS version").get<
    { version: string }
  >();
  if (row?.version !== "3.53.4") {
    throw new Error(`Expected SQLite 3.53.4, loaded ${row?.version}`);
  }
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (integrity?.integrity_check !== "ok") {
    throw new Error("SQLite integrity check failed");
  }
  console.log(
    JSON.stringify({
      deno: Deno.version.deno,
      architecture: Deno.build.target,
      sqlite: row.version,
      library: path,
    }),
  );
} finally {
  db.close();
}
