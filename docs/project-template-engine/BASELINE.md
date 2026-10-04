# Baseline validation

Base: `450452e1906a2b62ccef7e43ecfd52931f98792e` (`origin/main`, verified 2026-10-04).
Working branch: `codex/project-template-engine`, pushed before implementation.

## Dependency repair

- Retained every dependency version and the official SheetJS 0.20.3 tarball URL.
- Added the SHA-512 integrity of that downloaded tarball to its existing lock entry:
  `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
- Pinned `packageManager` to `pnpm@10.34.6`. The environment's default pnpm 11 ignores the existing package.json overrides; the intended pnpm 10 honors them.
- Frozen installation succeeded without disabling integrity or bypassing checks. CI mode was used once to replace the preinstalled modules tree without a TTY.

## Checks and baseline failure classification

Prisma generation, schema validation, full migration deployment, lint, typecheck and production build passed. All database operations used disposable PostgreSQL on localhost; no production database was accessed. Repository regression scripts were run, including Packaging stages 1–7, concept completion/revocation, folders, Private Projects, permissions, archive, and Tracker.

A — stale expectations repaired:

- Flexible Projects / Artwork Projects labels and extracted shared type-switcher UI.
- USER permission defaults now include archive uploads, and sidebar visibility includes Tracker.
- Stage 7 uses service-level access checks rather than the old blanket route-role guard.
- Sample decisions require receipt first; reminder fixtures now follow that workflow.
- Stage 3/4 validation messages now say task rather than concept.

B — genuine defects repaired:

- SheetJS lock integrity was absent.
- The Private Projects isolated test runner read `.env` directly. It now requires an explicit localhost `DATABASE_URL`.
- Archive search incorrectly treated a hyphenated UUID segment ending in `b` as a byte-size filter. Added a deterministic regression and preserved standalone size queries.

Local fixture setup: synthetic ADMIN, SUPER_ADMIN and USER records and `permissions:sync` were needed for legacy checks expecting existing users/catalog. These are test setup, not product failures.

C — product decisions: none required for baseline repair.
