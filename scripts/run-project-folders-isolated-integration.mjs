import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

// Always use a disposable local PostgreSQL cluster, never the app database.
const root = mkdtempSync(join(tmpdir(), "gti-folder-tests-"));
const data = join(root, "data"), socket = join(root, "socket");
mkdirSync(socket);
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}/postgres`,
  AWS_REGION: "us-east-1", AWS_S3_BUCKET: "folder-tests.invalid",
  AWS_ACCESS_KEY_ID: "folder-test", AWS_SECRET_ACCESS_KEY: "folder-test", S3_USE_ACCELERATE_ENDPOINT: "false",
};
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`);
  return result.stdout;
}
let started = false;
try {
  run("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
  run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -p ${port} -k ${socket} -h 127.0.0.1`, "-w", "start"]);
  started = true;
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
  console.log("All migrations applied to a disposable local database.");
  for (const [compiledRoot, script] of [
    [".tmp/project-folders", "project-folder-integration-check"],
    [".tmp/project-research-import", "project-research-import-check"],
    [".tmp/project-research-integration", "project-research-integration-check"],
    [".tmp/user-project-workspace-integration", "user-project-workspace-integration-check"],
  ]) {
    env.COMPILED_ALIAS_ROOT = compiledRoot;
    console.log(run("node", ["-r", "./scripts/register-compiled-alias.cjs", `${compiledRoot}/scripts/${script}.js`]).trim());
  }
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
