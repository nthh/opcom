import { TuiApp } from "../tui/app.js";

export async function runTui(): Promise<void> {
  const app = new TuiApp();
  await app.start();
}
