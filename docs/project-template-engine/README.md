# Project template engine delivery

Branch: `codex/project-template-engine`. Base: `450452e1906a2b62ccef7e43ecfd52931f98792e`, fetched and verified on `origin/main`. The working branch was pushed before implementation. Main was not changed or merged. No production database was accessed.

## Baseline and dependency repair

See [BASELINE.md](BASELINE.md) for failure classifications. The official SheetJS 0.20.3 URL and all intended dependency versions remain unchanged. The existing lock entry gained the downloaded tarball's SHA-512 integrity, and `packageManager` now selects pnpm 10.34.6. Frozen installation works with integrity verification enabled. No application dependency upgrades or bypass flags were used.

Baseline corrections include stale product terminology, fixtures matching current sample-receipt rules and permissions, an archive-search UUID/byte-filter collision, and enforcing explicit localhost configuration in the Private Projects test runner.

## Architecture and database

`ProjectTemplate → ProjectTemplateVersion → TemplateStageDefinition → ProjectStageInstance` separates editable master versions from project-owned snapshots. Publishing creates a new version; existing projects keep their source version and copied names, types, guidance, options and configuration. Stale publishing, approval and note edits fail with a reload message instead of overwriting another user's work.

New models:

- `ProjectTemplate`: stable key, current version and active flag.
- `ProjectTemplateVersion`: version number, author, reason and timestamp.
- `TemplateStageDefinition`: ordered definition, type, workspace binding, description, goal, guidance, definition of done, required/skippable options and configuration JSON.
- `ProjectStageInstance`: stable project-specific identity and copied configuration, state/timestamps, revisioned generic notes, skipped/retired markers and source definition.
- `ProjectStructureEvent`: actor, action, reason, timestamp and before/after data.

Project source, Custom approval and start/revision fields and an explicit User Director-template capability were added. The stable stage-instance identity and configuration extension point allow later tasks to reference a project, stage and optional typed item without replacing the legacy concept-task model. Fields, documents, folder rules, approvers, starter tasks and durations are extension points; no undefined business specifications were invented.

Migration: `prisma/migrations/20261004120000_project_template_engine/migration.sql`. It adds tables/columns/indexes, seeds definitions, backfills snapshots and installs a transactional compatibility trigger. It does not drop/recreate projects or alter historical attachment, revision, approval, checklist, production or sample tables.

## Existing project migration

Projects with persisted Packaging workflow rows receive **Legacy Packaging v0**, with seven stage instances. Saved status and unlock/completion timestamps are copied; absent legacy rows remain locked. Existing project IDs, completed state and all business records remain in place. Completed projects are not reopened, and active historical projects do not gain an unrequested eighth stage.

Projects without persisted workflow rows remain unclassified. The migration does not guess their workflow history. Private Projects use their existing separate models and are unaffected.

The existing Packaging services remain authoritative for their seven specialized states. A database trigger mirrors each legacy state transition into the corresponding snapshot in the same transaction. For new Packaging projects, completing Stage 7 unlocks Commercialisation; only completing that final stage closes the project. Legacy seven-stage closure remains supported.

## Project creation and templates

The required first selection is **Project Type / Template**. Selection displays the actual master version's stages before existing project fields. Owner, co-owners, executors, collaborators and self-management remain available under their existing eligibility rules. Creation writes the template snapshot in the same transaction as the project. Only Packaging creates legacy Packaging workflow records.

| Master | Initial stages |
| --- | --- |
| Packaging | Project Inquiry; Research & Planning; Initial Concept; Final Concept; File Checklist; Production & Handover; Implementation & Supervision; Commercialisation |
| POSM & Promotional Materials | Brief; Research / Sourcing; Concept & Design; Specification; Production & Approval; Delivery & Execution |
| Retail Display | Brief; Site Survey; Concept; Technical Design; Specification & Graphics per Component; Prototype & Production; Logistics & Installation |
| Exhibition Stand | Brief; Planning & Organiser Manual; Contractor Selection; Concept & Design; Graphics, Content & Linked Projects; Build-up; Event; Dismantling & Wrap-up Report |
| Digital | Brief; Discovery; UX Concept; UI Design; Specification & Content; Build & Testing; Launch & Handover; Maintenance Mode |
| Custom | Owner-defined list, awaiting Director approval |

Twelve extensible stage types cover brief, research, creative, specification, approval, production, acceptance, event, testing, report, maintenance and general work. Type describes intent; the workspace binding selects an implemented engine. Choosing “Approval Chain” on a Custom stage does not fabricate an approval engine.

## Governance, Custom builder and guidance

Super Admin can assign the explicit Director-template capability in Settings → Project templates. Capability holders can publish master versions and approve Custom structures. Ordinary administrators are not automatically template Directors. Checks read the current capability from the database. No person's name determines authority.

The builder supports add, rename, description, move up/down, duplicate, safe removal, optional/skippable options, stage type, goal, guidance and definition of done. Draft revisions require a reason, preserve stable instance IDs, soft-retire removed stages and record history. Editing invalidates prior approval. Custom stages stay locked until Director approval. Saving stage work or completing/skipping a stage freezes structural editing for this phase.

“What now?” displays Goal of this stage / What you must do / When you can move on. Unspecified master guidance stays empty with an honest placeholder. Generic workspaces provide saved notes, read-only completed history, ordered completion and reasoned skipping of optional skippable stages. Maintenance stays open without a forced end date or completion button.

Packaging master editing preserves specialized engine order, type and required state; names, descriptions and guidance may be versioned. This avoids breaking the mature engine's internal dependencies.

## Navigation and preservation

Overview, stage navigation, project cards, project filters, dashboard distribution and Tracker progress use the project's actual instances. Six, seven, eight and longer stage lists render without a seven-stage assumption. Cards have equal dimensions and two-line truncated titles. Browser checks cover a twelve-stage list with long names at 1440, 768 and 390 pixels.

Packaging reuses its existing inquiry/autosave/contact directory, research/folders, concept tasks/revisions/review, checklist requests/responses, production units/manual send/external approvals/handover and physical sample rounds/reminders/acceptance. Files, comments, existing activity and archive services remain in their existing workspaces. The new history screen adds template and structure audit information.

Owners and co-owners can manage their stages natively, including authorized USER project owners. Executor membership alone grants no stage overview or management routes and no template mutation access. Existing independent global-administration authority remains intact. Concept assignments retain their Tasker routes. Assigned physical sample requests now have a scoped `/tasks/samples/[roundId]` route; it exposes only that request and redirects old recipient deep links. Private milestones and Tracker row/project identities are unchanged.

## Verification and reproduction

Use pnpm 10.34.6 (`corepack pnpm`). All database checks below were run against local PostgreSQL 17 with synthetic fixtures, never production.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| Prisma generate and schema validation | Passed |
| Local migration deploy | Passed, including all prior migrations |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| Repository regression scripts | 62 passed, including the new template integration suite |
| `pnpm build` | Passed (Next.js 16.2.6 production build) |
| Real Chromium browser checks | Passed: creation/progression, approval, access, 12-stage layouts; no browser errors |

The full regression inventory is in [validation-results.json](validation-results.json). Tests with changed assumptions were rerun after correction, along with tests affected by subsequent source changes. Passing unrelated checks were not repeatedly rerun.

`pnpm templates:integration-check` requires local PostgreSQL tools (`initdb`, `pg_ctl`, `psql`) on PATH. It starts a disposable loopback cluster, applies the old migrations, inserts historical active/completed fixtures and a task/revision/file relationship, then applies the new migration. It checks all template counts, snapshot isolation, Director permissions, Custom reorder/removal/approval/concurrent edits, owner/co-owner/executor access, generic progression/skipping, Packaging Stage 7→8 closure, Maintenance, and retained historical identities/timestamps.

The optional browser runner uses an existing local production server and optional Playwright/Chromium installation; it adds no application dependencies:

```sh
# Set DATABASE_URL explicitly to the same isolated localhost database used by the server.
# Generate compiled services first with pnpm templates:integration-check.
TEMPLATE_BROWSER_URL=http://127.0.0.1:3100 \
PLAYWRIGHT_MODULE_PATH=/path/to/playwright-core \
CHROMIUM_PATH=/path/to/chromium \
COMPILED_ALIAS_ROOT=.tmp/project-template-engine \
node -r ./scripts/register-compiled-alias.cjs scripts/project-template-browser-check.cjs
```

It creates uniquely named synthetic users/projects and removes them in `finally`. Screenshots are saved under `.tmp/template-browser`. Real outgoing email, real object-storage delivery and production operational load were not exercised.

## Limitations, decisions and merge risks

- Non-Packaging stages and Commercialisation use the generic notes workspace. Their business fields, acceptance requirements and specialized engines await Director specifications. Maintenance task handling through Tasker is future work.
- Custom structures are immutable after work begins. A future controlled amendment workflow needs rules for in-flight tasks, approval and history; no destructive amendment shortcut was added.
- The builder currently validates 1–100 stages, 160-character names and 10,000-character guidance fields. This is an input-size safeguard, not a fixed workflow count.
- Director capability is assigned by Super Admin. GTI must choose its actual capability holders. Capability assignment itself uses the existing user permission pattern; template publications and project structural edits have separate audit records.
- Legacy projects retain seven stages. Adding Commercialisation to an already running project would require a separately reviewed opt-in migration.
- Legacy rows with no workflow stay unclassified; inspect any such production anomalies before deciding how to initialize them.
- New stage history shows the most recent 200 events; full records remain stored. Master versions are immutable through the application; database administrators retain their normal direct database authority.
- Before merging/deploying, review the additive migration and compatibility trigger, back up production using the normal release procedure, and rehearse against a staging copy. The backfill performs transactional writes proportional to the number of existing projects; production duration/locking was not measured. Deploy the migration with the matching application release. Rolling back application code alone does not remove new project types.
- No Phase 2 systems, full generic Tasker rewrite, production migration, merge or deployment were performed.

## Checkpoints

- `09e2123`: frozen dependency baseline and regression repair.
- `2ec2e06`: versioned templates, additive migration, project snapshots, creation, Custom builder and dynamic workspaces.
- `f0060c0`: navigation/filter compatibility, native Packaging ownership, scoped sample Tasker access and expanded validation.
- Final documentation/validation checkpoint follows these commits on the same branch.
