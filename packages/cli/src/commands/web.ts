import { Station } from "@opcom/core";

export async function runWeb(): Promise<void> {
  const status = await Station.isRunning();
  if (!status.running) {
    console.log("  Station not running.");
    console.log("  Run 'opcom serve' first, then 'opcom web'.");
    return;
  }

  const url = `http://localhost:${status.port ?? 4700}`;
  console.log(`  Opening ${url} in browser...`);

  // Open in default browser
  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
}
