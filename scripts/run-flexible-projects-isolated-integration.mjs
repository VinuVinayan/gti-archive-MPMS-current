import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

function readDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Set DATABASE_URL to an isolated local PostgreSQL database.");
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Isolated integration checks require a localhost database.");
  }
  return raw;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? "unknown"}.`);
  }
}

const databaseUrl = readDatabaseUrl();
const schemaName = `flexible_projects_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
const directDatabaseUrl = new URL(databaseUrl);
directDatabaseUrl.hostname = directDatabaseUrl.hostname.replace(/-pooler(?=\.)/, "");
const testUrl = new URL(directDatabaseUrl);
testUrl.searchParams.set("schema", schemaName);
const connectionOptions = testUrl.searchParams.get("options");
testUrl.searchParams.set(
  "options",
  [connectionOptions, `-c search_path=${schemaName}`].filter(Boolean).join(" "),
);
const testEnvironment = { ...process.env, DATABASE_URL: testUrl.toString() };
const migrationRoot = mkdtempSync(join(tmpdir(), "gti-flexible-migrations-"));
const temporaryPrismaDirectory = join(migrationRoot, "prisma");
mkdirSync(join(temporaryPrismaDirectory, "migrations"), { recursive: true });
copyFileSync("prisma/schema.prisma", join(temporaryPrismaDirectory, "schema.prisma"));
copyFileSync(
  "prisma/migrations/migration_lock.toml",
  join(temporaryPrismaDirectory, "migrations", "migration_lock.toml"),
);
for (const directory of readdirSync("prisma/migrations")) {
  const source = join("prisma/migrations", directory, "migration.sql");
  if (existsSync(source)) {
    cpSync(join("prisma/migrations", directory), join(temporaryPrismaDirectory, "migrations", directory), {
      recursive: true,
    });
  }
}

try {
  run(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", join(temporaryPrismaDirectory, "schema.prisma")],
    testEnvironment,
  );
  run(
    "node",
    [
      "-r",
      "./scripts/register-compiled-alias.cjs",
      ".tmp/flexible-projects-integration/scripts/flexible-projects-integration-check.js",
    ],
    { ...testEnvironment, COMPILED_ALIAS_ROOT: ".tmp/flexible-projects-integration" },
  );
} finally {
  const cleanupUrl = new URL(directDatabaseUrl);
  cleanupUrl.searchParams.set("schema", "public");
  const cleanup = new PrismaClient({ datasourceUrl: cleanupUrl.toString() });
  try {
    await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await cleanup.$disconnect();
    rmSync(migrationRoot, { recursive: true, force: true });
  }
}
