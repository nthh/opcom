import { describe, it, expect } from "vitest";
import { substituteVariables } from "../../packages/core/src/templates/substitution.js";

describe("substituteVariables", () => {
  it("replaces single variable", () => {
    expect(substituteVariables("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = substituteVariables(
      "Trip to {{destination}} for {{travelers}} people",
      { destination: "Japan", travelers: "2" },
    );
    expect(result).toBe("Trip to Japan for 2 people");
  });

  it("replaces same variable multiple times", () => {
    const result = substituteVariables(
      "{{city}} is great. Visit {{city}}!",
      { city: "Tokyo" },
    );
    expect(result).toBe("Tokyo is great. Visit Tokyo!");
  });

  it("leaves unmatched placeholders as-is", () => {
    const result = substituteVariables(
      "{{known}} and {{unknown}}",
      { known: "yes" },
    );
    expect(result).toBe("yes and {{unknown}}");
  });

  it("handles hyphenated variable names", () => {
    const result = substituteVariables(
      "Event: {{event-name}} on {{date}}",
      { "event-name": "Launch Party", date: "June 15" },
    );
    expect(result).toBe("Event: Launch Party on June 15");
  });

  it("handles empty variables map", () => {
    expect(substituteVariables("No {{vars}} here", {})).toBe("No {{vars}} here");
  });

  it("handles text with no placeholders", () => {
    expect(substituteVariables("Plain text", { foo: "bar" })).toBe("Plain text");
  });

  it("handles empty string", () => {
    expect(substituteVariables("", { foo: "bar" })).toBe("");
  });
});
