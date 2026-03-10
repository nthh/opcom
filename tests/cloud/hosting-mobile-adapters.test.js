"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
const emptyStack = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
};
// =============================================================================
// Firebase Hosting parsing
// =============================================================================
(0, vitest_1.describe)("parseFirebaseHosting", () => {
    (0, vitest_1.it)("parses single hosting config", () => {
        const json = JSON.stringify({
            hosting: { public: "dist", rewrites: [{ source: "**", destination: "/index.html" }] },
        });
        const result = (0, core_1.parseFirebaseHosting)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.publicDir).toBe("dist");
        (0, vitest_1.expect)(result.rewrites).toBe(true);
    });
    (0, vitest_1.it)("parses hosting config with target (multi-site)", () => {
        const json = JSON.stringify({
            hosting: { target: "app", public: "build" },
        });
        const result = (0, core_1.parseFirebaseHosting)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.site).toBe("app");
        (0, vitest_1.expect)(result.publicDir).toBe("build");
    });
    (0, vitest_1.it)("parses array hosting config (multi-site)", () => {
        const json = JSON.stringify({
            hosting: [
                { target: "app", public: "dist" },
                { target: "admin", public: "admin/dist" },
            ],
        });
        const result = (0, core_1.parseFirebaseHosting)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.site).toBe("app");
        (0, vitest_1.expect)(result.publicDir).toBe("dist");
    });
    (0, vitest_1.it)("returns detected=false when no hosting config", () => {
        const json = JSON.stringify({ functions: { source: "functions" } });
        const result = (0, core_1.parseFirebaseHosting)(json);
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
    (0, vitest_1.it)("returns detected=false for invalid JSON", () => {
        const result = (0, core_1.parseFirebaseHosting)("not json");
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
    (0, vitest_1.it)("handles hosting with no rewrites", () => {
        const json = JSON.stringify({
            hosting: { public: "public" },
        });
        const result = (0, core_1.parseFirebaseHosting)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.publicDir).toBe("public");
        (0, vitest_1.expect)(result.rewrites).toBe(false);
    });
});
// =============================================================================
// Framework detection
// =============================================================================
(0, vitest_1.describe)("detectHostingFramework", () => {
    (0, vitest_1.it)("detects React (via react-scripts)", () => {
        const pkg = JSON.stringify({ dependencies: { "react-scripts": "5.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("create-react-app");
    });
    (0, vitest_1.it)("detects Vite", () => {
        const pkg = JSON.stringify({ devDependencies: { vite: "^5.0.0", react: "^18.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("vite");
    });
    (0, vitest_1.it)("detects Next.js", () => {
        const pkg = JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("next");
    });
    (0, vitest_1.it)("detects Vue", () => {
        const pkg = JSON.stringify({ dependencies: { vue: "^3.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("vue");
    });
    (0, vitest_1.it)("detects Angular", () => {
        const pkg = JSON.stringify({ dependencies: { "@angular/core": "^17.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("angular");
    });
    (0, vitest_1.it)("detects SvelteKit", () => {
        const pkg = JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBe("sveltekit");
    });
    (0, vitest_1.it)("infers react from build dir", () => {
        const pkg = JSON.stringify({ dependencies: {} });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg, "build")).toBe("react");
    });
    (0, vitest_1.it)("returns undefined when no framework detected", () => {
        const pkg = JSON.stringify({ dependencies: { express: "^4.0.0" } });
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)(pkg)).toBeUndefined();
    });
    (0, vitest_1.it)("handles invalid JSON", () => {
        (0, vitest_1.expect)((0, core_1.detectHostingFramework)("not json")).toBeUndefined();
    });
});
// =============================================================================
// Firebase Hosting detection
// =============================================================================
(0, vitest_1.describe)("detectFirebaseHosting", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-fbhost-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from firebase.json with hosting config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            hosting: { public: "dist", rewrites: [{ source: "**", destination: "/index.html" }] },
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({ projects: { default: "my-project" } }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("firebase-hosting");
        (0, vitest_1.expect)(result.kind).toBe("hosting");
        (0, vitest_1.expect)(result.firebaseProject).toBe("my-project");
        (0, vitest_1.expect)(result.publicDir).toBe("dist");
    });
    (0, vitest_1.it)("detects framework from package.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { public: "dist" } }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ devDependencies: { vite: "^5.0.0" } }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.framework).toBe("vite");
    });
    (0, vitest_1.it)("returns null when firebase.json has no hosting config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ functions: { source: "functions" } }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null when firebase.json does not exist", async () => {
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("uses site target name when available", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { target: "app", public: "dist" } }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("app");
        (0, vitest_1.expect)(result.site).toBe("app");
    });
    (0, vitest_1.it)("defaults name to 'hosting' when no target", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { public: "dist" } }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("hosting");
    });
    (0, vitest_1.it)("detects multi-site hosting (array)", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            hosting: [
                { target: "web", public: "dist" },
                { target: "admin", public: "admin/dist" },
            ],
        }));
        const result = await (0, core_1.detectFirebaseHosting)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("web");
        (0, vitest_1.expect)(result.site).toBe("web");
    });
});
// =============================================================================
// Expo app.json parsing
// =============================================================================
(0, vitest_1.describe)("parseAppJson", () => {
    (0, vitest_1.it)("parses standard expo app.json", () => {
        const json = JSON.stringify({
            expo: {
                name: "MyApp",
                slug: "my-app",
                version: "1.0.0",
                ios: { bundleIdentifier: "com.example.myapp" },
                android: { package: "com.example.myapp" },
            },
        });
        const result = (0, core_1.parseAppJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.slug).toBe("my-app");
        (0, vitest_1.expect)(result.platform).toBe("both");
        (0, vitest_1.expect)(result.version).toBe("1.0.0");
    });
    (0, vitest_1.it)("detects iOS-only config", () => {
        const json = JSON.stringify({
            expo: {
                name: "iOSApp",
                slug: "ios-app",
                ios: { bundleIdentifier: "com.example.app" },
            },
        });
        const result = (0, core_1.parseAppJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.platform).toBe("ios");
    });
    (0, vitest_1.it)("detects android-only config", () => {
        const json = JSON.stringify({
            expo: {
                name: "AndroidApp",
                slug: "android-app",
                android: { package: "com.example.app" },
            },
        });
        const result = (0, core_1.parseAppJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.platform).toBe("android");
    });
    (0, vitest_1.it)("handles bare workflow (no expo wrapper)", () => {
        const json = JSON.stringify({
            name: "MyApp",
            slug: "my-app",
            version: "2.0.0",
        });
        const result = (0, core_1.parseAppJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.slug).toBe("my-app");
    });
    (0, vitest_1.it)("returns detected=false for empty config", () => {
        const json = JSON.stringify({});
        const result = (0, core_1.parseAppJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
    (0, vitest_1.it)("returns detected=false for invalid JSON", () => {
        const result = (0, core_1.parseAppJson)("not json");
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
});
// =============================================================================
// EAS JSON parsing
// =============================================================================
(0, vitest_1.describe)("parseEasJson", () => {
    (0, vitest_1.it)("parses eas.json with production build profile", () => {
        const json = JSON.stringify({
            build: {
                production: {
                    channel: "production",
                    distribution: "store",
                },
                preview: {
                    channel: "preview",
                    distribution: "internal",
                },
            },
        });
        const result = (0, core_1.parseEasJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.channel).toBe("production");
        (0, vitest_1.expect)(result.distribution).toBe("store");
    });
    (0, vitest_1.it)("detects ad-hoc distribution", () => {
        const json = JSON.stringify({
            build: {
                production: {
                    distribution: "internal",
                },
            },
        });
        const result = (0, core_1.parseEasJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.distribution).toBe("ad-hoc");
    });
    (0, vitest_1.it)("defaults to ota distribution", () => {
        const json = JSON.stringify({
            build: {
                development: { developmentClient: true },
            },
        });
        const result = (0, core_1.parseEasJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.distribution).toBe("ota");
    });
    (0, vitest_1.it)("detects submit config", () => {
        const json = JSON.stringify({
            build: { production: {} },
            submit: { production: { ios: { appleId: "test@example.com" } } },
        });
        const result = (0, core_1.parseEasJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.hasSubmit).toBe(true);
    });
    (0, vitest_1.it)("returns detected=false when no build/submit config", () => {
        const json = JSON.stringify({ cli: { version: "3.0.0" } });
        const result = (0, core_1.parseEasJson)(json);
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
    (0, vitest_1.it)("returns detected=false for invalid JSON", () => {
        const result = (0, core_1.parseEasJson)("not json");
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
});
// =============================================================================
// Publish command detection
// =============================================================================
(0, vitest_1.describe)("detectPublishCommand", () => {
    (0, vitest_1.it)("detects npm run publish script", () => {
        const pkg = JSON.stringify({
            scripts: { publish: "eas update --auto" },
        });
        (0, vitest_1.expect)((0, core_1.detectPublishCommand)(pkg)).toBe("npm run publish");
    });
    (0, vitest_1.it)("detects ota script", () => {
        const pkg = JSON.stringify({
            scripts: { ota: "npx eas update --branch production" },
        });
        (0, vitest_1.expect)((0, core_1.detectPublishCommand)(pkg)).toBe("npm run ota");
    });
    (0, vitest_1.it)("detects script containing eas update", () => {
        const pkg = JSON.stringify({
            scripts: { release: "eas update --auto --non-interactive" },
        });
        (0, vitest_1.expect)((0, core_1.detectPublishCommand)(pkg)).toBe("npm run release");
    });
    (0, vitest_1.it)("returns undefined when no publish command found", () => {
        const pkg = JSON.stringify({
            scripts: { start: "node index.js", test: "vitest" },
        });
        (0, vitest_1.expect)((0, core_1.detectPublishCommand)(pkg)).toBeUndefined();
    });
    (0, vitest_1.it)("handles invalid JSON", () => {
        (0, vitest_1.expect)((0, core_1.detectPublishCommand)("not json")).toBeUndefined();
    });
});
// =============================================================================
// Expo/EAS detection
// =============================================================================
(0, vitest_1.describe)("detectExpoEAS", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-eas-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from app.json with expo config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.json"), JSON.stringify({
            expo: {
                name: "Mtnmap",
                slug: "mtnmap",
                version: "2.3.1",
                ios: { bundleIdentifier: "com.example.mtnmap" },
            },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("expo-eas");
        (0, vitest_1.expect)(result.kind).toBe("mobile");
        (0, vitest_1.expect)(result.name).toBe("mtnmap");
        (0, vitest_1.expect)(result.expoSlug).toBe("mtnmap");
        (0, vitest_1.expect)(result.platform).toBe("ios");
    });
    (0, vitest_1.it)("detects from app.json + eas.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.json"), JSON.stringify({
            expo: {
                name: "MyApp",
                slug: "my-app",
                ios: {},
                android: {},
            },
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "eas.json"), JSON.stringify({
            build: {
                production: { channel: "production", distribution: "store" },
            },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.updateChannel).toBe("production");
        (0, vitest_1.expect)(result.distribution).toBe("store");
        (0, vitest_1.expect)(result.platform).toBe("both");
    });
    (0, vitest_1.it)("detects from app.config.ts + package.json with expo dep", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.config.ts"), `export default { name: "app" };`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "my-expo-app",
            dependencies: { expo: "^51.0.0" },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("expo-eas");
        (0, vitest_1.expect)(result.name).toBe("my-expo-app");
    });
    (0, vitest_1.it)("detects from package.json with expo dependency only", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "expo-only",
            dependencies: { expo: "^51.0.0", "react-native": "^0.74.0" },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("expo-eas");
        (0, vitest_1.expect)(result.name).toBe("expo-only");
    });
    (0, vitest_1.it)("detects custom publish command", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.json"), JSON.stringify({ expo: { name: "App", slug: "app" } }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            scripts: { publish: "npm version patch && eas update --auto" },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.publishCommand).toBe("npm run publish");
    });
    (0, vitest_1.it)("returns null when no expo markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null for empty directory", async () => {
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("detects from eas.json alone (without app.json) + expo dep", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "eas.json"), JSON.stringify({ build: { production: { channel: "production" } } }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "eas-only-app",
            dependencies: { expo: "^51.0.0" },
        }));
        const result = await (0, core_1.detectExpoEAS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.updateChannel).toBe("production");
    });
});
// =============================================================================
// Cloud detection integration — hosting & mobile adapters in Tier 4
// =============================================================================
(0, vitest_1.describe)("detectCloudServices (hosting & mobile)", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-cloud-hostmobile-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects Firebase Hosting from firebase.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { public: "dist" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const hosting = result.configs.find((c) => c.provider === "firebase-hosting");
        (0, vitest_1.expect)(hosting).toBeDefined();
        (0, vitest_1.expect)(hosting.kind).toBe("hosting");
        const evidence = result.evidence.find((e) => e.detectedAs === "cloud:firebase-hosting");
        (0, vitest_1.expect)(evidence).toBeDefined();
    });
    (0, vitest_1.it)("detects Expo/EAS from app.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.json"), JSON.stringify({ expo: { name: "App", slug: "app" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const mobile = result.configs.find((c) => c.provider === "expo-eas");
        (0, vitest_1.expect)(mobile).toBeDefined();
        (0, vitest_1.expect)(mobile.kind).toBe("mobile");
        const evidence = result.evidence.find((e) => e.detectedAs === "cloud:expo-eas");
        (0, vitest_1.expect)(evidence).toBeDefined();
    });
    (0, vitest_1.it)("detects hosting alongside serverless and database services", async () => {
        // Mtnmap-like setup: Neon + CF Workers + Firebase Functions + Firebase Hosting + Expo
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n");
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "api"\nroute = "api.example.com/*"`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            functions: { source: "functions" },
            hosting: { public: "dist" },
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "app.json"), JSON.stringify({ expo: { name: "App", slug: "app", ios: {} } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        (0, vitest_1.expect)(result.configs.length).toBeGreaterThanOrEqual(5);
        const neon = result.configs.find((c) => c.provider === "neon");
        const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
        const fbFunctions = result.configs.find((c) => c.provider === "firebase-functions");
        const fbHosting = result.configs.find((c) => c.provider === "firebase-hosting");
        const expo = result.configs.find((c) => c.provider === "expo-eas");
        (0, vitest_1.expect)(neon).toBeDefined();
        (0, vitest_1.expect)(workers).toBeDefined();
        (0, vitest_1.expect)(fbFunctions).toBeDefined();
        (0, vitest_1.expect)(fbHosting).toBeDefined();
        (0, vitest_1.expect)(expo).toBeDefined();
    });
    (0, vitest_1.it)("detects Firebase Hosting alongside Firebase Functions from same firebase.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            functions: { source: "functions" },
            hosting: { public: "dist", target: "web" },
        }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const fbFunctions = result.configs.find((c) => c.provider === "firebase-functions");
        const fbHosting = result.configs.find((c) => c.provider === "firebase-hosting");
        (0, vitest_1.expect)(fbFunctions).toBeDefined();
        (0, vitest_1.expect)(fbHosting).toBeDefined();
        (0, vitest_1.expect)(fbHosting.name).toBe("web");
    });
    (0, vitest_1.it)("returns no hosting or mobile when no markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "simple-app", dependencies: {} }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const hosting = result.configs.filter((c) => c.kind === "hosting");
        const mobile = result.configs.filter((c) => c.kind === "mobile");
        (0, vitest_1.expect)(hosting).toHaveLength(0);
        (0, vitest_1.expect)(mobile).toHaveLength(0);
    });
});
//# sourceMappingURL=hosting-mobile-adapters.test.js.map