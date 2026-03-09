import { describe, it, expect } from "vitest";
import { getLayout } from "./layout.js";

describe("L2 layout with cloud panel", () => {
  it("includes a cloud panel in L2", () => {
    const layout = getLayout(2, 120, 40);
    const cloudPanel = layout.panels.find((p) => p.id === "cloud");

    expect(cloudPanel).toBeDefined();
    expect(cloudPanel!.width).toBeGreaterThan(0);
    expect(cloudPanel!.height).toBeGreaterThan(0);
  });

  it("has 7 panels in L2", () => {
    const layout = getLayout(2, 120, 40);
    expect(layout.panels).toHaveLength(7);
    expect(layout.panels.map((p) => p.id)).toEqual(["tickets", "agents", "specs", "stack", "cloud", "cicd", "chat"]);
  });

  it("cloud panel is positioned below stack panel", () => {
    const layout = getLayout(2, 120, 40);
    const stackPanel = layout.panels.find((p) => p.id === "stack")!;
    const cloudPanel = layout.panels.find((p) => p.id === "cloud")!;

    expect(cloudPanel.y).toBe(stackPanel.y + stackPanel.height);
    expect(cloudPanel.x).toBe(stackPanel.x);
    expect(cloudPanel.width).toBe(stackPanel.width);
  });

  it("panels fill the right column height", () => {
    const layout = getLayout(2, 120, 40);
    const agentsPanel = layout.panels.find((p) => p.id === "agents")!;
    const chatPanel = layout.panels.find((p) => p.id === "chat")!;
    const usableRows = 40 - 1; // minus status bar

    expect(agentsPanel.y).toBe(0);
    expect(chatPanel.y + chatPanel.height).toBe(usableRows);
  });

  it("L1 layout has no cloud panel", () => {
    const layout = getLayout(1, 120, 40);
    expect(layout.panels).toHaveLength(4);
    expect(layout.panels.map((p) => p.id)).toEqual(["projects", "workqueue", "agents", "chat"]);
    expect(layout.panels.find((p) => p.id === "cloud")).toBeUndefined();
  });

  it("L3 layout is unchanged (single focus panel)", () => {
    const layout = getLayout(3, 120, 40);
    expect(layout.panels).toHaveLength(1);
    expect(layout.panels[0].id).toBe("focus");
  });
});
