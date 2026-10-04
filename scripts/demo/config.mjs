import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const DB_NAME = "flux_demo";
export const DB_USER = "flux_demo";
// Public, fake credentials for this loopback-only demo cluster, never a secret.
export const DB_PASSWORD = "FluxDemoDatabase-Only!";
export const DB_PORT = 55439;

export function demoDatabaseUrl(database = DB_NAME) {
  if (![DB_NAME, "postgres"].includes(database))
    throw new Error("Invalid demo database.");
  return `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@127.0.0.1:${DB_PORT}/${database}`;
}

export function assertDemoDatabaseUrl(value) {
  if (value !== demoDatabaseUrl())
    throw new Error(
      "Demo operations require the fixed, isolated demo database URL.",
    );
}

export function assertOwnedCluster(actualDirectory, expectedDirectory) {
  if (realpathSync(actualDirectory) !== realpathSync(expectedDirectory)) {
    throw new Error(
      "Refusing operation: PostgreSQL is not the cluster owned by this checkout.",
    );
  }
}

export function demoEnvironment(inherited, root, port = 3101) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid demo HTTP port.");
  // Retain operating-system/runtime transport settings, never inherited service credentials.
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "COMSPEC",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  return {
    ...env,
    NODE_ENV: "development",
    FLUX_DEMO_MODE: "local",
    FLUX_DEMO_DATA_DIRECTORY: resolve(root, ".demo/postgres"),
    DATABASE_URL: demoDatabaseUrl(),
    DIRECT_URL: demoDatabaseUrl(),
    PGHOST: "127.0.0.1",
    PGPORT: String(DB_PORT),
    PGUSER: DB_USER,
    PGPASSWORD: DB_PASSWORD,
    PGDATABASE: "postgres",
    APP_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_REALTIME_PROVIDER: "none",
    ABLY_API_KEY: "",
    NEXT_PUBLIC_ABLY_CLIENT_ID_PREFIX: "flux-demo",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
    OPENAI_API_KEY: "",
    OPENAI_FLUX_AI_MODEL: "",
    OPENAI_STAGE_SUMMARY_MODEL: "",
    OPENAI_TRANSCRIPTION_MODEL: "",
    OPENAI_TRANSLATION_MODEL: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_SESSION_TOKEN: "",
    AWS_REGION: "",
    AWS_S3_BUCKET: "",
    AWS_PROFILE: "",
    AWS_EC2_METADATA_DISABLED: "true",
    S3_USE_ACCELERATE_ENDPOINT: "false",
    AWS_S3_TRANSFER_ACCELERATION: "false",
    SLAVOMIR_APPROVAL_EMAIL: "director@flux-demo.test",
    CRON_SECRET: "",
    NEXT_TELEMETRY_DISABLED: "1",
    COMPILED_ALIAS_ROOT: resolve(root, ".tmp/demo-seed"),
  };
}
