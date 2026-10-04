/** Demo Mode is opt-in and must never use a remote or non-demo datasource. */
export function assertDemoModeDatabase() {
  if (process.env.FLUX_DEMO_MODE !== "local") return;
  const url = new URL(process.env.DATABASE_URL ?? "file:///missing");
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/flux_demo" ||
    url.username !== "flux_demo" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Demo Mode requires its dedicated loopback PostgreSQL database. Use pnpm demo.",
    );
  }
}
