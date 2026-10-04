import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDemoDatabaseUrl,
  assertOwnedCluster,
  demoDatabaseUrl,
  demoEnvironment,
} from "./config.mjs";

test("Demo environment replaces inherited service credentials and datasource", () => {
  const env = demoEnvironment(
    {
      PATH: "/local/bin",
      HOME: "/local/home",
      DATABASE_URL: "postgresql://do-not-use.invalid/production",
      DIRECT_URL: "postgresql://do-not-use.invalid/production",
      RESEND_API_KEY: "fake-inherited-key",
      AWS_ACCESS_KEY_ID: "fake-inherited-key",
      OPENAI_API_KEY: "fake-inherited-key",
      ABLY_API_KEY: "fake-inherited-key",
      NODE_OPTIONS: "--require=untrusted-file",
      PGSERVICE: "production",
      UNKNOWN_SERVICE_SECRET: "must-not-copy",
      HTTPS_PROXY: "http://proxy.example.test",
      NODE_EXTRA_CA_CERTS: "/local/ca.pem",
    },
    "/local/checkout",
  );
  assert.equal(env.DATABASE_URL, demoDatabaseUrl());
  assert.equal(env.DIRECT_URL, demoDatabaseUrl());
  for (const key of [
    "RESEND_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET",
    "AWS_REGION",
    "OPENAI_API_KEY",
    "ABLY_API_KEY",
  ])
    assert.equal(env[key], "");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.UNKNOWN_SERVICE_SECRET, undefined);
  assert.equal(env.HTTPS_PROXY, "http://proxy.example.test");
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/local/ca.pem");
  assert.equal(env.NEXT_PUBLIC_REALTIME_PROVIDER, "none");
  assert.equal(env.APP_URL, "http://127.0.0.1:3101");
});

test("Demo URL guard refuses other local databases, remote hosts and query overrides", () => {
  assert.doesNotThrow(() => assertDemoDatabaseUrl(demoDatabaseUrl()));
  for (const unsafe of [
    "postgresql://example.invalid/flux_demo",
    demoDatabaseUrl("postgres"),
    demoDatabaseUrl().replace("127.0.0.1", "localhost"),
    `${demoDatabaseUrl()}?host=example.invalid`,
    `${demoDatabaseUrl()}?schema=production`,
    demoDatabaseUrl().replace("55439", "55432"),
    undefined,
  ])
    assert.throws(() => assertDemoDatabaseUrl(unsafe), /isolated demo/);
  assert.throws(() => demoDatabaseUrl("production"));
  for (const port of [80, -1, NaN, 65536, 3101.2])
    assert.throws(() => demoEnvironment({}, "/demo", port));
});

test("Reset ownership guard refuses a different PostgreSQL data directory", () => {
  const root = mkdtempSync(join(tmpdir(), "flux-demo-guard-"));
  try {
    const owned = join(root, "owned"),
      other = join(root, "other");
    mkdirSync(owned);
    mkdirSync(other);
    assert.doesNotThrow(() => assertOwnedCluster(owned, owned));
    assert.throws(
      () => assertOwnedCluster(other, owned),
      /not the cluster owned/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
