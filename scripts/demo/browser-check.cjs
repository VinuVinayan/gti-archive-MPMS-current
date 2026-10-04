/* eslint-disable @typescript-eslint/no-require-imports -- Optional CommonJS browser QA runner. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const fixtures = require("./fixtures.json");
const projects = JSON.parse(readFileSync(".demo/projects.json", "utf8"));
const base = process.env.DEMO_BROWSER_URL || "http://127.0.0.1:3101";
assert.equal(
  new URL(base).hostname,
  "127.0.0.1",
  "Demo browser QA only accepts loopback URLs.",
);
const inquiry = projects.find((project) => project.name.includes("— inquiry"));
const custom = projects.find((project) =>
  project.name.includes("awaiting Director"),
);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const errors = [];
  try {
    for (const user of fixtures.users) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/sign-in`);
      await page.getByText(/DEMO \/ QA · Fake data/).waitFor();
      await page.getByLabel("Email address").fill(user.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/");
      if (["demo-super-admin", "demo-director"].includes(user.id)) {
        await page.goto(`${base}/settings/project-templates`);
        await page
          .getByRole("heading", { name: "Project templates", exact: true })
          .waitFor();
        await page.goto(`${base}/projects/${custom.id}/structure`);
        await page
          .getByRole("button", { name: "Approve project structure" })
          .waitFor();
      } else if (["demo-owner", "demo-co-owner"].includes(user.id)) {
        await page.goto(`${base}/projects/${inquiry.id}`);
        await page
          .getByRole("heading", { name: "Project stages", exact: true })
          .waitFor();
        assert.equal(await page.locator("article:visible").count(), 8);
        await page.goto(`${base}/projects/${inquiry.id}/stages/1`);
        await page
          .getByRole("heading", {
            name: "Stage 1 - Project Inquiry",
            exact: true,
          })
          .waitFor();
        if (user.id === "demo-owner") {
          await page.goto(`${base}/projects/flexible/demo-private-planning`);
          await page
            .getByText("[DEMO] Private planning notes", { exact: true })
            .first()
            .waitFor();
        }
      } else {
        if (user.id === "demo-executor") {
          await page.goto(`${base}/tasks`);
          await page
            .getByText("DEMO — Explore two carton directions", { exact: true })
            .first()
            .waitFor();
        }
        await page.goto(`${base}/projects/${inquiry.id}/stages/1`, {
          waitUntil: "networkidle",
        });
        assert.equal(
          await page
            .getByRole("heading", { name: "Project stages", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("heading", {
              name: "Stage 1 - Project Inquiry",
              exact: true,
            })
            .count(),
          0,
        );
      }
      console.log(`PASS real login and role access: ${user.email}`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Demo browser QA passed; no browser errors. Fixture project state was not changed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
