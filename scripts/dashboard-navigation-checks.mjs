import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { getDashboardBackNavigation } from "../src/lib/dashboard-navigation.ts";

function navigation(pathname, query = "") {
  return getDashboardBackNavigation(pathname, new URLSearchParams(query));
}

function expectNavigation(pathname, expected, query = "") {
  assert.deepEqual(
    navigation(pathname, query),
    expected,
    `Unexpected navigation policy for ${pathname}${query ? `?${query}` : ""}`,
  );
}

expectNavigation("/dashboard", { owner: "none" });
expectNavigation("/project-tracker", {
  owner: "topbar",
  href: "/",
  label: "Dashboard",
  ariaLabel: "Back to Dashboard",
});
expectNavigation("/projects", { owner: "none" });
expectNavigation("/projects/new", {
  owner: "topbar",
  href: "/projects",
  label: "Projects",
  ariaLabel: "Back to Projects",
});
expectNavigation("/projects/project-1", {
  owner: "topbar",
  href: "/projects",
  label: "Projects",
  ariaLabel: "Back to Projects",
});
expectNavigation("/projects/project-1", {
  owner: "topbar",
  href: "/projects?view=mine",
  label: "Projects",
  ariaLabel: "Back to Projects",
}, "returnTo=%2Fprojects%3Fview%3Dmine");
expectNavigation("/projects/project-1", {
  owner: "topbar",
  href: "/project-tracker",
  label: "Project Tracker",
  ariaLabel: "Back to Project Tracker",
}, "returnTo=%2Fproject-tracker");
expectNavigation("/projects/project-1/edit", {
  owner: "topbar",
  href: "/projects/project-1",
  label: "Project Overview",
  ariaLabel: "Back to Project Overview",
});
expectNavigation("/projects/flexible/flexible-project-1", {
  owner: "topbar",
  href: "/projects?view=flexible",
  label: "Private Projects",
  ariaLabel: "Back to Private Projects",
});
expectNavigation("/projects/flexible/flexible-project-1", {
  owner: "topbar",
  href: "/project-tracker",
  label: "Project Tracker",
  ariaLabel: "Back to Project Tracker",
}, "returnTo=%2Fproject-tracker");
expectNavigation("/projects/flexible/flexible-project-1/milestones/milestone-1", {
  owner: "topbar",
  href: "/projects/flexible/flexible-project-1",
  label: "Project Overview",
  ariaLabel: "Back to Project Overview",
});

for (const stage of ["1", "2", "3", "4", "5", "6", "7"]) {
  expectNavigation(`/projects/project-1/stages/${stage}`, {
    owner: "topbar",
    href: "/projects/project-1",
    label: "Project Overview",
    ariaLabel: "Back to Project Overview",
  });
}

expectNavigation("/projects/project-1/stages/2/folders/folder-1", { owner: "page" });
expectNavigation("/projects/project-1/stages/3/concepts/concept-1", {
  owner: "topbar",
  href: "/projects/project-1/stages/3/concepts",
  label: "Concept Folders",
  ariaLabel: "Back to Stage 3 Concept Folders",
});
expectNavigation("/projects/project-1/stages/3/concepts/concept-1", {
  owner: "topbar",
  href: "/tasks",
  label: "Tasks",
  ariaLabel: "Back to Tasks",
}, "returnTo=%2Ftasks");
expectNavigation("/projects/project-1/stages/4/concepts/concept-1", {
  owner: "topbar",
  href: "/projects/project-1/stages/4/concepts",
  label: "Concept Folders",
  ariaLabel: "Back to Stage 4 Concept Folders",
});
expectNavigation("/projects/project-1/stages/3/concepts", {
  owner: "topbar",
  href: "/projects/project-1/stages/3",
  label: "Stage 3",
  ariaLabel: "Back to Stage 3",
});
expectNavigation("/projects/project-1/stages/4/concepts", {
  owner: "topbar",
  href: "/projects/project-1/stages/4",
  label: "Stage 4",
  ariaLabel: "Back to Stage 4",
});
expectNavigation("/projects/project-1/stages/3/concepts/concept-1/compare", {
  owner: "topbar",
  href: "/projects/project-1/stages/3/concepts/concept-1",
  label: "Concept Chat",
  ariaLabel: "Back to Concept Chat",
});
expectNavigation("/projects/project-1/stages/4/concepts/concept-1/compare", {
  owner: "topbar",
  href: "/projects/project-1/stages/4/concepts/concept-1",
  label: "Concept Chat",
  ariaLabel: "Back to Concept Chat",
});
expectNavigation("/projects/project-1/chat", {
  owner: "topbar",
  href: "/projects/project-1",
  label: "Project Overview",
  ariaLabel: "Back to Project Overview",
});
expectNavigation("/projects/project-1/compare", {
  owner: "topbar",
  href: "/projects/project-1/chat?stage=stage%2F1",
  label: "Stage Chat",
  ariaLabel: "Back to Stage Chat",
}, "stage=stage%2F1");
expectNavigation("/archives/category-1", {
  owner: "topbar",
  href: "/archives",
  label: "Archives",
  ariaLabel: "Back to Archives",
});
expectNavigation("/settings/project-master-data", {
  owner: "topbar",
  href: "/settings",
  label: "Settings",
  ariaLabel: "Back to Settings",
});

const [appFrame, topbar, backButton, stageTwoFolder, stageTwoFolderPage, compare, masterData, routeState, conceptChat] =
  await Promise.all([
    readFile("src/components/layout/dashboard-app-frame.tsx", "utf8"),
    readFile("src/components/layout/topbar.tsx", "utf8"),
    readFile("src/components/projects/project-back-button.tsx", "utf8"),
    readFile("src/components/projects/stage-two-folder-workspace.tsx", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/2/folders/[folderId]/page.tsx", "utf8"),
    readFile("src/components/projects/project-compare-workspace.tsx", "utf8"),
    readFile("src/components/settings/project-master-data-workspace.tsx", "utf8"),
    readFile("src/components/projects/project-route-state.tsx", "utf8"),
    readFile("src/components/projects/concept-chat-route.tsx", "utf8"),
  ]);

assert(
  appFrame.includes("getDashboardBackNavigation") &&
    appFrame.includes('navigation.owner !== "topbar"') &&
    !appFrame.includes("router.back") &&
    !appFrame.includes("BackPill"),
  "The dashboard frame must use the centralized deterministic navigation policy.",
);
assert.equal(
  stageTwoFolder.match(/<ProjectBackButton/g)?.length,
  2,
  "The shared folder workspace must define one contextual parent control per research/private context.",
);
assert(
  stageTwoFolder.includes('href={`/projects/${data.project.id}/stages/2`}') &&
    !stageTwoFolder.includes("workspace=") &&
    stageTwoFolder.includes('ariaLabel="Back to Stage 2 Research Workspace"') &&
    stageTwoFolder.includes('ariaLabel="Back to project workspace"') &&
    !stageTwoFolderPage.includes("leadingContent"),
  "Stage 2 folder navigation must preserve workspace context and suppress a page-declared topbar Back.",
);
assert(
  !compare.includes("Back to stage chat") && !masterData.includes("Back to Settings"),
  "Pages governed by topbar navigation must not retain duplicate page-level Back actions.",
);
assert(
  !routeState.includes("Back to Projects") &&
    routeState.match(/<ProjectBackButton/g)?.length === 1,
  "Project route states must expose at most one optional parent action.",
);
assert(
  !conceptChat.includes("ProjectBackButton") &&
    conceptChat.includes("stageNeutral: true") &&
    conceptChat.includes("backHref: backHref ?? `/projects/${encodeURIComponent(projectId)}`") &&
    conceptChat.includes('backLabel: backHref === "/tasks" ? "Back to Tasks" : "Back to Workspace"'),
  "USER concept chat must preserve its stage-neutral return context without adding a duplicate page-level control.",
);
assert(
  backButton.includes('aria-label={ariaLabel ?? label}') &&
    backButton.includes('className="sm:hidden">Back') &&
    backButton.includes('className="hidden sm:inline">{label}') &&
    topbar.includes("justify-between") &&
    !topbar.includes("min-w-[250px]"),
  "Back controls must be accessible and compact on mobile without leaving a desktop placeholder.",
);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(target);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return files.flat();
}

const dashboardFiles = await collectSourceFiles("src/app/(dashboard)");
const dashboardSource = (
  await Promise.all(dashboardFiles.map((file) => readFile(file, "utf8")))
).join("\n");
assert(
  !dashboardSource.includes("router.back()") &&
    !dashboardSource.includes("window.history.back"),
  "Dashboard parent navigation must never depend on browser history.",
);

console.log("Dashboard route and single-back navigation checks passed.");
