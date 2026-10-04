import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const root = mkdtempSync(join(tmpdir(), "flux-template-tests-"));
const data = join(root, "data"),
  socket = join(root, "socket"),
  baseline = join(root, "prisma");
mkdirSync(socket);
mkdirSync(join(baseline, "migrations"), { recursive: true });
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
  NEXT_PUBLIC_REALTIME_PROVIDER: "none",
  AWS_REGION: "us-east-1",
  AWS_S3_BUCKET: "template-tests.invalid",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  S3_USE_ACCELERATE_ENDPOINT: "false",
  TEMPLATE_MIGRATION_FIXTURE: "1",
  COMPILED_ALIAS_ROOT: ".tmp/project-template-engine",
};
function run(command, args) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      result.stderr ||
        result.stdout ||
        result.error?.message ||
        `${command} failed`,
    );
  return result.stdout;
}
cpSync("prisma/schema.prisma", join(baseline, "schema.prisma"));
for (const entry of readdirSync("prisma/migrations"))
  if (entry !== "20261004120000_project_template_engine")
    cpSync(
      join("prisma/migrations", entry),
      join(baseline, "migrations", entry),
      { recursive: true },
    );
let started = false;
try {
  run("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-F -p ${port} -k ${socket} -h 127.0.0.1`,
    "-w",
    "start",
  ]);
  started = true;
  run("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    join(baseline, "schema.prisma"),
  ]);
  const fixture = join(root, "fixture.sql");
  writeFileSync(
    fixture,
    `
INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ('template-migration-user','migration@example.test','local-test','ADMIN',CURRENT_TIMESTAMP);
INSERT INTO "Project" ("id","name","ownerId","createdById","updatedAt") VALUES ('template-migration-fixture','Preserved live-style project','template-migration-user','template-migration-user',CURRENT_TIMESTAMP);
INSERT INTO "ProjectWorkflowStage" ("id","projectId","stageKey","status","unlockedAt","completedAt","updatedAt") VALUES ('template-migration-workflow','template-migration-fixture','PROJECT_INQUIRY','COMPLETED','2026-01-01','2026-01-02','2026-01-02'),('template-migration-research','template-migration-fixture','PROJECT_RESEARCH_AND_PLANNING','AVAILABLE','2026-01-02',NULL,'2026-01-02');
INSERT INTO "Project" ("id","name","ownerId","createdById","completedAt","updatedAt") VALUES ('template-migration-closed','Completed historical project','template-migration-user','template-migration-user','2026-02-01','2026-02-01');
INSERT INTO "ProjectWorkflowStage" ("id","projectId","stageKey","status","completedAt","updatedAt") SELECT 'template-migration-closed-' || key::text,'template-migration-closed',key,'COMPLETED','2026-02-01','2026-02-01' FROM unnest(enum_range(NULL::"ProjectWorkflowStageKey")) AS key;
INSERT INTO "ProjectStage" ("id","projectId","name","order","status","updatedAt") VALUES ('template-migration-task','template-migration-fixture','Historical task',1,'COMPLETED',CURRENT_TIMESTAMP);
INSERT INTO "ProjectRevision" ("id","projectId","stageId","createdById","revisionNumber","title","status","updatedAt") VALUES ('template-migration-revision','template-migration-fixture','template-migration-task','template-migration-user',1,'Approved historical revision','APPROVED',CURRENT_TIMESTAMP);
INSERT INTO "ProjectAttachment" ("id","projectId","stageId","revisionId","uploadedById","fileName","originalFileName","mimeType","fileSize","bucket","storageKey","assetType","status","updatedAt") VALUES ('template-migration-file','template-migration-fixture','template-migration-task','template-migration-revision','template-migration-user','fixture.pdf','fixture.pdf','application/pdf',123,'local.invalid','preserved/migration-fixture.pdf','STAGE_SUBMISSION','READY',CURRENT_TIMESTAMP);
`,
  );
  run("psql", [env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", fixture]);
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
  console.log(
    "Baseline data fixture migrated in place on isolated local PostgreSQL.",
  );
  console.log(
    run("node", [
      "-r",
      "./scripts/register-compiled-alias.cjs",
      ".tmp/project-template-engine/scripts/project-template-engine-check.js",
    ]),
  );
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
