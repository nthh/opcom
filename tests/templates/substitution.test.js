"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const substitution_js_1 = require("../../packages/core/src/templates/substitution.js");
(0, vitest_1.describe)("substituteVariables", () => {
    (0, vitest_1.it)("replaces single variable", () => {
        (0, vitest_1.expect)((0, substitution_js_1.substituteVariables)("Hello {{name}}", { name: "World" })).toBe("Hello World");
    });
    (0, vitest_1.it)("replaces multiple variables", () => {
        const result = (0, substitution_js_1.substituteVariables)("Trip to {{destination}} for {{travelers}} people", { destination: "Japan", travelers: "2" });
        (0, vitest_1.expect)(result).toBe("Trip to Japan for 2 people");
    });
    (0, vitest_1.it)("replaces same variable multiple times", () => {
        const result = (0, substitution_js_1.substituteVariables)("{{city}} is great. Visit {{city}}!", { city: "Tokyo" });
        (0, vitest_1.expect)(result).toBe("Tokyo is great. Visit Tokyo!");
    });
    (0, vitest_1.it)("leaves unmatched placeholders as-is", () => {
        const result = (0, substitution_js_1.substituteVariables)("{{known}} and {{unknown}}", { known: "yes" });
        (0, vitest_1.expect)(result).toBe("yes and {{unknown}}");
    });
    (0, vitest_1.it)("handles hyphenated variable names", () => {
        const result = (0, substitution_js_1.substituteVariables)("Event: {{event-name}} on {{date}}", { "event-name": "Launch Party", date: "June 15" });
        (0, vitest_1.expect)(result).toBe("Event: Launch Party on June 15");
    });
    (0, vitest_1.it)("handles empty variables map", () => {
        (0, vitest_1.expect)((0, substitution_js_1.substituteVariables)("No {{vars}} here", {})).toBe("No {{vars}} here");
    });
    (0, vitest_1.it)("handles text with no placeholders", () => {
        (0, vitest_1.expect)((0, substitution_js_1.substituteVariables)("Plain text", { foo: "bar" })).toBe("Plain text");
    });
    (0, vitest_1.it)("handles empty string", () => {
        (0, vitest_1.expect)((0, substitution_js_1.substituteVariables)("", { foo: "bar" })).toBe("");
    });
});
//# sourceMappingURL=substitution.test.js.map