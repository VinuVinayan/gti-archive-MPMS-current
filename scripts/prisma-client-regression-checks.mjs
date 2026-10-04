import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [prismaSource, permissionProfiles, demoModeSource] = await Promise.all([
  readFile("src/lib/prisma.ts", "utf8"),
  readFile("src/lib/permissions/profiles.ts", "utf8"),
  readFile("src/lib/demo-mode.ts", "utf8"),
]);

assert(
  prismaSource.includes("prismaReconnectPromise?: Promise<void>") &&
    prismaSource.includes("globalForPrisma.prismaReconnectPromise") &&
    prismaSource.includes("await reconnectPrismaClient()"),
  "Transient Prisma recovery must be shared across parallel server renders.",
);
assert(
  !prismaSource.includes("await prisma.$disconnect()"),
  "Request-time retry must not disconnect the shared Prisma client.",
);
assert(
  /withPrismaRetry\(\(\) =>\s*prisma\.userArchiveAccess\.findUnique\(/.test(
    permissionProfiles,
  ),
  "Permission snapshot archive access must use transient connection recovery.",
);

console.log("Prisma shared-client connection recovery checks passed.");

// Exercise the module cache with two generated schemas that share a delegate.
const [{ default: ts }, { runInNewContext }] = await Promise.all([
  import("typescript"), import("node:vm"),
]);
const generated = {
  dmmf: { datamodel: { models: [{ name: "ProjectResearchFolderFile", fields: [{ name: "id", type: "String" }] }], enums: [] } },
};
let createdClients = 0;
class TestPrismaClient {
  constructor() {
    createdClients += 1;
    this.projectResearchFolderFile = {};
    this._previewFeatures = ["relationJoins"];
  }
}
const sharedGlobal = {};
const compiled = ts.transpileModule(prismaSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledDemoMode = ts.transpileModule(demoModeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function reloadPrismaModule(env = { NODE_ENV: "development" }) {
  const testModule = { exports: {} };
  const demoModule = { exports: {} };
  runInNewContext(compiledDemoMode, { exports: demoModule.exports, process: { env }, URL });
  runInNewContext(compiled, {
    exports: testModule.exports,
    require: (name) => {
      if (name === "./demo-mode") return demoModule.exports;
      if (name === "@prisma/client") return { Prisma: generated, PrismaClient: TestPrismaClient };
      throw new Error(`Unexpected import: ${name}`);
    },
    globalThis: sharedGlobal,
    process: { env },
    console,
  });
  return testModule.exports.prisma;
}
const initialClient = reloadPrismaModule();
assert.equal(reloadPrismaModule(), initialClient, "Identical schemas must reuse the shared client.");
generated.dmmf.datamodel.models[0].fields.push({ name: "inquiryImportKey", type: "String" });
const refreshedClient = reloadPrismaModule();
assert.notEqual(refreshedClient, initialClient, "Adding a field to an existing model must replace the cached client.");
assert.equal(reloadPrismaModule(), refreshedClient, "The updated client must be reused after refresh.");
delete sharedGlobal.prismaSchemaSignature;
assert.notEqual(reloadPrismaModule(), refreshedClient, "Clients from before schema tracking must be replaced.");
assert.equal(createdClients, 3);
console.log("Prisma schema-change cache checks passed.");

for (const databaseUrl of [
  "postgresql://example.invalid/production",
  "postgresql://flux_demo@127.0.0.1:55439/postgres",
  "postgresql://flux_demo@127.0.0.1:55439/flux_demo?host=example.invalid",
]) {
  assert.throws(() => reloadPrismaModule({ NODE_ENV: "development", FLUX_DEMO_MODE: "local", DATABASE_URL: databaseUrl }), /dedicated loopback/);
}
assert.equal(createdClients, 3, "Unsafe Demo Mode URLs must fail before constructing a database client.");
assert.doesNotThrow(() => reloadPrismaModule({ NODE_ENV: "development", FLUX_DEMO_MODE: "local", DATABASE_URL: "postgresql://flux_demo@127.0.0.1:55439/flux_demo" }));
console.log("Demo Mode datasource guard checks passed before Prisma client creation.");
