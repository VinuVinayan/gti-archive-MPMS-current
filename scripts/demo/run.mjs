import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_PORT,
  assertDemoDatabaseUrl,
  assertOwnedCluster,
  demoEnvironment,
} from "./config.mjs";

const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);
const state = join(root, ".demo");
const data = join(state, "postgres");
const marker = join(state, "owner.json");
const lock = join(state, "runner.json");
const action = process.argv[2] ?? "start";
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);
const port = Number(process.env.FLUX_DEMO_PORT ?? 3101);
const env = demoEnvironment(process.env, root, port);
let child;
let locked = false;

function credentials() {
  console.log(`\nFLUX DEMO / QA — http://127.0.0.1:${port}/sign-in`);
  console.log("Public FAKE logins (local demo only):");
  for (const user of fixtures.users)
    console.log(`  ${user.name.padEnd(20)} ${user.email}`);
  console.log(`  Password for all six: ${fixtures.password}`);
  console.log("Email, cloud storage, AI and external realtime are disabled.");
  console.log(
    "pnpm demo preserves changes. pnpm demo:reset replaces ONLY the demo database.",
  );
  console.log("Stop the app with Ctrl+C. Data persists in .demo/postgres.\n");
}
function run(command, args, quiet = true) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  appendFileSync(join(state, "setup.log"), output);
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error?.message ?? output.slice(-6000)}`,
    );
  if (!quiet && output) console.log(output.trim());
  return result.stdout.trim();
}
function node(relative, args = [], quiet = true) {
  return run(process.execPath, [join(root, relative), ...args], quiet);
}
function discoverPostgres(saved) {
  const candidates = [process.env.FLUX_DEMO_PG_BIN, saved?.pgBin];
  candidates.push(...(process.env.PATH ?? "").split(":"));
  const configured = spawnSync("pg_config", ["--bindir"], {
    env,
    encoding: "utf8",
  });
  if (configured.status === 0) candidates.push(configured.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) {
    for (const version of readdirSync("/usr/lib/postgresql").sort().reverse())
      candidates.push(`/usr/lib/postgresql/${version}/bin`);
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (
      ["initdb", "pg_ctl", "psql"].every((file) =>
        existsSync(join(candidate, file)),
      )
    )
      return resolve(candidate);
  }
  throw new Error(
    "Install PostgreSQL 17 tools (initdb, pg_ctl, psql), or set FLUX_DEMO_PG_BIN to their directory. See docs/DEMO.md.",
  );
}
function acquireLock() {
  if (existsSync(lock)) {
    const saved = JSON.parse(readFileSync(lock, "utf8"));
    try {
      process.kill(saved.pid, 0);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      rmSync(lock);
    }
    if (existsSync(lock))
      throw new Error(
        "Demo Mode is already running. Stop it with Ctrl+C before reset, setup or stop.",
      );
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), {
    flag: "wx",
    mode: 0o600,
  });
  locked = true;
}
function releaseLock() {
  if (locked) rmSync(lock, { force: true });
  locked = false;
}
function psql(database, query) {
  return run("psql", [
    "-X",
    "-w",
    "-h",
    "127.0.0.1",
    "-p",
    String(DB_PORT),
    "-U",
    DB_USER,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    query,
  ]);
}
function verifyCluster() {
  assertDemoDatabaseUrl(env.DATABASE_URL);
  const config = JSON.parse(readFileSync(marker, "utf8"));
  if (
    config.kind !== "flux-local-demo-v1" ||
    config.root !== root ||
    config.port !== DB_PORT
  )
    throw new Error("Demo ownership marker does not match this checkout.");
  assertOwnedCluster(psql("postgres", "SHOW data_directory"), data);
}
async function main() {
  if (
    !["start", "setup", "reset", "stop", "credentials", "verify"].includes(
      action,
    )
  )
    throw new Error(
      "Usage: pnpm demo [start|setup|reset|stop|credentials|verify]",
    );
  if (action === "credentials") {
    credentials();
    return;
  }
  if (existsSync(state) && lstatSync(state).isSymbolicLink())
    throw new Error("The .demo directory must not be a symlink.");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  acquireLock();
  if (existsSync(data) && lstatSync(data).isSymbolicLink())
    throw new Error(
      "The demo PostgreSQL data directory must not be a symlink.",
    );
  const saved = existsSync(marker)
    ? JSON.parse(readFileSync(marker, "utf8"))
    : null;
  if (
    saved &&
    (saved.kind !== "flux-local-demo-v1" ||
      saved.root !== root ||
      saved.port !== DB_PORT)
  )
    throw new Error("Refusing to reuse an unrecognized demo cluster.");
  if (!saved && existsSync(data))
    throw new Error(
      "Unmarked PostgreSQL data exists. Refusing to adopt or reset it.",
    );
  const pgBin = discoverPostgres(saved);
  env.PATH = `${pgBin}:${env.PATH ?? ""}`;
  if (action === "stop" && !existsSync(join(data, "PG_VERSION"))) {
    console.log("No demo database is running.");
    return;
  }
  if (!existsSync(join(data, "PG_VERSION"))) {
    console.log(
      "Creating a dedicated persistent PostgreSQL demo cluster on 127.0.0.1:55439...",
    );
    writeFileSync(
      marker,
      JSON.stringify({
        kind: "flux-local-demo-v1",
        root,
        port: DB_PORT,
        pgBin,
      }),
      { mode: 0o600 },
    );
    const passwordFile = join(state, "init-password");
    writeFileSync(passwordFile, DB_PASSWORD, { mode: 0o600 });
    try {
      run("initdb", [
        "-D",
        data,
        "-U",
        DB_USER,
        "--auth-host=scram-sha-256",
        "--auth-local=scram-sha-256",
        "--pwfile",
        passwordFile,
        "--no-locale",
        "--encoding=UTF8",
      ]);
    } finally {
      rmSync(passwordFile, { force: true });
    }
  }
  const status = spawnSync(join(pgBin, "pg_ctl"), ["-D", data, "status"], {
    env,
    encoding: "utf8",
  });
  if (action === "stop") {
    if (status.status === 0) {
      verifyCluster();
      run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    }
    console.log("Demo PostgreSQL stopped. Saved data is retained.");
    return;
  }
  if (status.status !== 0)
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      join(state, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${DB_PORT} -k ''`,
      "-w",
      "start",
    ]);
  verifyCluster();
  const exists =
    psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`) ===
    "1";
  if (action === "reset" && exists) {
    // No force, cascade, arbitrary target, URL argument or production connection.
    // Fails if another app still has active connections to the demo database.
    console.log(
      "Resetting ONLY flux_demo in this checkout's marked local cluster...",
    );
    psql("postgres", 'DROP DATABASE "flux_demo"');
  }
  if (!exists || action === "reset")
    psql("postgres", 'CREATE DATABASE "flux_demo" OWNER "flux_demo"');
  psql(
    DB_NAME,
    "CREATE SCHEMA IF NOT EXISTS flux_demo_meta; CREATE TABLE IF NOT EXISTS flux_demo_meta.state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  console.log(
    "Generating Prisma, applying local migrations and compiling demo fixtures...",
  );
  node("node_modules/prisma/build/index.js", ["generate"]);
  node("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  node("node_modules/typescript/bin/tsc", [
    "--project",
    "scripts/tsconfig.demo.json",
  ]);
  run(
    process.execPath,
    [
      "-r",
      "./scripts/register-compiled-alias.cjs",
      ".tmp/demo-seed/scripts/demo/seed.js",
      action === "verify" ? "verify" : "seed",
    ],
    false,
  );
  credentials();
  if (action !== "start") return;
  console.log("Launching the current checkout in Demo Mode...");
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  await new Promise((resolveChild, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code && !signal
        ? reject(new Error(`Demo app exited with code ${code}`))
        : resolveChild(),
    );
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (child) child.kill(signal);
    else {
      releaseLock();
      process.exit(130);
    }
  });
try {
  await main();
} catch (error) {
  console.error(`Demo Mode: ${error.message}`);
  process.exitCode = 1;
} finally {
  releaseLock();
}
