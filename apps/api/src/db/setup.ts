// One-time database setup: applies db/schema.sql (if not applied yet) and the
// seed files to the database in DATABASE_URL. Safe to run more than once.
//   npm run db:setup -w @synapse/api
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { pgConfig } from "./client.js";

const root = new URL("../../../../", import.meta.url);
config({ path: fileURLToPath(new URL(".env", root)) });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

// Run statements one at a time: continuous aggregates can't be created inside
// the implicit transaction of a multi-statement query.
function statements(file: string) {
  return readFileSync(new URL(file, root), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

const client = new pg.Client(pgConfig(process.env.DATABASE_URL));
await client.connect();

const { rows: [v] } = await client.query(
  `SELECT current_setting('server_version') AS pg,
          (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS tsdb`,
);
console.log(`Connected: Postgres ${v.pg}, TimescaleDB ${v.tsdb ?? "not installed"}`);

const { rows: [s] } = await client.query("SELECT to_regclass('public.encounters') IS NOT NULL AS exists");
if (s.exists) {
  console.log("Schema already applied, skipping db/schema.sql");
} else {
  for (const stmt of statements("db/schema.sql")) await client.query(stmt);
  console.log("Applied db/schema.sql");
}

// Migrations upgrade databases created from an older schema.sql; each is idempotent.
const migrations = readdirSync(new URL("db/migrations/", root))
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of migrations) {
  for (const stmt of statements(`db/migrations/${file}`)) await client.query(stmt);
  console.log(`Applied db/migrations/${file}`);
}

// Seeds: the demo encounter first (encounters.sql), then sample data.
const seeds = readdirSync(new URL("db/seed/", root))
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => (a === "encounters.sql" ? -1 : b === "encounters.sql" ? 1 : a.localeCompare(b)));
for (const file of seeds) {
  for (const stmt of statements(`db/seed/${file}`)) await client.query(stmt);
  console.log(`Applied db/seed/${file}`);
}

const { rows: [c] } = await client.query(
  `SELECT (SELECT count(*) FROM encounters) AS encounters,
          (SELECT count(*) FROM utterances) AS utterances,
          (SELECT count(*) FROM pain_readings) AS pain_readings,
          (SELECT count(*) FROM timescaledb_information.hypertables
            WHERE hypertable_name IN ('utterances', 'pain_readings')) AS hypertables,
          (SELECT materialized_only FROM timescaledb_information.continuous_aggregates
            WHERE view_name = 'pain_by_minute') AS materialized_only,
          (SELECT count(*) FROM utterances WHERE id IS NULL) AS missing_ids`,
);
console.log(
  `Rows: ${c.encounters} encounters, ${c.utterances} utterances, ${c.pain_readings} pain readings; ` +
    `${c.hypertables}/2 hypertables; pain_by_minute real-time: ${c.materialized_only === false}; ` +
    `utterances without id: ${c.missing_ids}`,
);
await client.end();
