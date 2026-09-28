import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile("src/app/(dashboard)/projects/[slug]/stages/2/actions.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const testModule = { exports: {} };
let failure = new Error("Invalid Prisma invocation: Unknown argument inquiryImportKey at /private/server/path");
const serverErrors = [];
runInNewContext(compiled, {
  exports: testModule.exports,
  Error,
  console: { error: (...args) => serverErrors.push(args) },
  require: (name) => {
    if (name === "@/lib/auth") return { requireUser: async () => ({ id: "test-user" }) };
    if (name === "@/lib/project-research-import") return {
      getProjectResearchImportFolders: async () => [],
      getProjectResearchImportOptions: async () => { throw failure; },
      importProjectInquiryContent: async () => { throw failure; },
    };
    return {};
  },
});
const input = { projectId: "project", folderId: "folder", itemIds: ["file"] };
assert.equal((await testModule.exports.getProjectResearchImportOptionsAction(input)).error, "Unable to load Stage 1 content. Please try again.");
assert.equal((await testModule.exports.importProjectInquiryContentAction(input)).error, "Unable to import Stage 1 content. Please try again.");
assert.equal(serverErrors.length, 2, "Technical errors must remain available in server logs.");
for (const message of [
  "This folder set is read-only for your account.",
  "Some selected Stage 1 content has changed or is unavailable. Reopen Import and select it again.",
]) {
  failure = new Error(message);
  assert.equal((await testModule.exports.importProjectInquiryContentAction(input)).error, message, "Actionable permission and stale-selection errors must remain visible.");
}
console.log("Research import public-error checks passed.");
