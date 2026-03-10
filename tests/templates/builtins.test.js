"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const builtins_js_1 = require("../../packages/core/src/templates/builtins.js");
(0, vitest_1.describe)("built-in templates", () => {
    (0, vitest_1.it)("has 4 built-in templates", () => {
        (0, vitest_1.expect)(builtins_js_1.BUILTIN_TEMPLATES).toHaveLength(4);
    });
    (0, vitest_1.it)("includes software, operations, travel, event", () => {
        const ids = builtins_js_1.BUILTIN_TEMPLATES.map((t) => t.id);
        (0, vitest_1.expect)(ids).toContain("software");
        (0, vitest_1.expect)(ids).toContain("operations");
        (0, vitest_1.expect)(ids).toContain("travel");
        (0, vitest_1.expect)(ids).toContain("event");
    });
    (0, vitest_1.it)("all templates have required fields", () => {
        for (const t of builtins_js_1.BUILTIN_TEMPLATES) {
            (0, vitest_1.expect)(t.id).toBeTruthy();
            (0, vitest_1.expect)(t.name).toBeTruthy();
            (0, vitest_1.expect)(t.description).toBeTruthy();
            (0, vitest_1.expect)(Object.keys(t.tickets).length).toBeGreaterThan(0);
            (0, vitest_1.expect)(t.agentsMd).toBeTruthy();
        }
    });
    (0, vitest_1.it)("software template has expected tickets", () => {
        const software = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "software");
        const files = Object.keys(software.tickets);
        (0, vitest_1.expect)(files).toContain("setup-ci.md");
        (0, vitest_1.expect)(files).toContain("setup-testing.md");
        (0, vitest_1.expect)(files).toContain("initial-feature.md");
    });
    (0, vitest_1.it)("travel template has variables", () => {
        const travel = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "travel");
        (0, vitest_1.expect)(travel.variables).toBeDefined();
        const varNames = travel.variables.map((v) => v.name);
        (0, vitest_1.expect)(varNames).toContain("destination");
        (0, vitest_1.expect)(varNames).toContain("dates");
        (0, vitest_1.expect)(varNames).toContain("travelers");
    });
    (0, vitest_1.it)("event template has variables", () => {
        const event = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "event");
        (0, vitest_1.expect)(event.variables).toBeDefined();
        const varNames = event.variables.map((v) => v.name);
        (0, vitest_1.expect)(varNames).toContain("event-name");
        (0, vitest_1.expect)(varNames).toContain("date");
        (0, vitest_1.expect)(varNames).toContain("expected-guests");
    });
    (0, vitest_1.it)("travel template tickets contain variable placeholders", () => {
        const travel = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "travel");
        const flightsContent = travel.tickets["book-flights.md"];
        (0, vitest_1.expect)(flightsContent).toContain("{{destination}}");
        (0, vitest_1.expect)(flightsContent).toContain("{{travelers}}");
        (0, vitest_1.expect)(flightsContent).toContain("{{dates}}");
    });
    (0, vitest_1.it)("templates without variables have none defined", () => {
        const software = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "software");
        (0, vitest_1.expect)(software.variables).toBeUndefined();
        const operations = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "operations");
        (0, vitest_1.expect)(operations.variables).toBeUndefined();
    });
});
//# sourceMappingURL=builtins.test.js.map