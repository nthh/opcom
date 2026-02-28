import { Station } from "@opcom/core";

export async function runServe(options: { port?: number }): Promise<void> {
  const port = options.port ?? 4700;

  // Check if already running
  const status = await Station.isRunning();
  if (status.running) {
    console.log(`  Station already running (PID ${status.pid}, port ${status.port})`);
    return;
  }

  const station = new Station(port);
  console.log(`  Starting opcom station on port ${port}...`);

  await station.start();
  console.log(`  Station running. PID: ${process.pid}`);
  console.log(`  REST: http://localhost:${port}`);
  console.log(`  WebSocket: ws://localhost:${port}`);
  console.log(`  Health: http://localhost:${port}/health`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down station...");
    await station.stop();
    console.log("  Station stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
