import { describe, it, expect } from "vitest";
import { BUILTIN_TEMPLATES } from "../../packages/core/src/templates/builtins.js";

describe("built-in templates", () => {
  it("has 4 built-in templates", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);
  });

  it("includes software, operations, travel, event", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("software");
    expect(ids).toContain("operations");
    expect(ids).toContain("travel");
    expect(ids).toContain("event");
  });

  it("all templates have required fields", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Object.keys(t.tickets).length).toBeGreaterThan(0);
      expect(t.agentsMd).toBeTruthy();
    }
  });

  it("software template has expected tickets", () => {
    const software = BUILTIN_TEMPLATES.find((t) => t.id === "software")!;
    const files = Object.keys(software.tickets);
    expect(files).toContain("setup-ci.md");
    expect(files).toContain("setup-testing.md");
    expect(files).toContain("initial-feature.md");
  });

  it("travel template has variables", () => {
    const travel = BUILTIN_TEMPLATES.find((t) => t.id === "travel")!;
    expect(travel.variables).toBeDefined();
    const varNames = travel.variables!.map((v) => v.name);
    expect(varNames).toContain("destination");
    expect(varNames).toContain("dates");
    expect(varNames).toContain("travelers");
  });

  it("event template has variables", () => {
    const event = BUILTIN_TEMPLATES.find((t) => t.id === "event")!;
    expect(event.variables).toBeDefined();
    const varNames = event.variables!.map((v) => v.name);
    expect(varNames).toContain("event-name");
    expect(varNames).toContain("date");
    expect(varNames).toContain("expected-guests");
  });

  it("travel template tickets contain variable placeholders", () => {
    const travel = BUILTIN_TEMPLATES.find((t) => t.id === "travel")!;
    const flightsContent = travel.tickets["book-flights.md"];
    expect(flightsContent).toContain("{{destination}}");
    expect(flightsContent).toContain("{{travelers}}");
    expect(flightsContent).toContain("{{dates}}");
  });

  it("templates without variables have none defined", () => {
    const software = BUILTIN_TEMPLATES.find((t) => t.id === "software")!;
    expect(software.variables).toBeUndefined();

    const operations = BUILTIN_TEMPLATES.find((t) => t.id === "operations")!;
    expect(operations.variables).toBeUndefined();
  });
});
