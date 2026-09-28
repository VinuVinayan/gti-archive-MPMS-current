import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [prismaSource, permissionProfiles] = await Promise.all([
  readFile("src/lib/prisma.ts", "utf8"),
  readFile("src/lib/permissions/profiles.ts", "utf8"),
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
function reloadPrismaModule() {
  const testModule = { exports: {} };
  runInNewContext(compiled, {
    exports: testModule.exports,
    require: () => ({ Prisma: generated, PrismaClient: TestPrismaClient }),
    globalThis: sharedGlobal,
    process: { env: { NODE_ENV: "development" } },
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
