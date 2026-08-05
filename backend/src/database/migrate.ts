#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationsDirectory = resolve(
  process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "migrations"),
);
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock($1)", [1_934_366_601]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const appliedResult = await client.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM schema_migrations",
  );
  const applied = new Map(
    appliedResult.rows.map((row) => [row.name, row.checksum.trim()]),
  );
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const appliedChecksum = applied.get(name);
    if (appliedChecksum) {
      if (appliedChecksum !== checksum) {
        throw new Error(`Applied migration ${name} has been modified`);
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied migration ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock($1)", [1_934_366_601]).catch(
    () => undefined,
  );
  client.release();
  await pool.end();
}
