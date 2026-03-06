import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseFirebaseHosting,
  detectHostingFramework,
  detectFirebaseHosting,
  parseAppJson,
  parseEasJson,
  detectPublishCommand,
  detectExpoEAS,
  detectCloudServices,
} from "@opcom/core";
import type { StackInfo } from "@opcom/types";

const emptyStack: StackInfo = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  infrastructure: [],
  versionManagers: [],
};

// =============================================================================
// Firebase Hosting parsing
// =============================================================================

describe("parseFirebaseHosting", () => {
  it("parses single hosting config", () => {
    const json = JSON.stringify({
      hosting: { public: "dist", rewrites: [{ source: "**", destination: "/index.html" }] },
    });
    const result = parseFirebaseHosting(json);
    expect(result.detected).toBe(true);
    expect(result.publicDir).toBe("dist");
    expect(result.rewrites).toBe(true);
  });

  it("parses hosting config with target (multi-site)", () => {
    const json = JSON.stringify({
      hosting: { target: "app", public: "build" },
    });
    const result = parseFirebaseHosting(json);
    expect(result.detected).toBe(true);
    expect(result.site).toBe("app");
    expect(result.publicDir).toBe("build");
  });

  it("parses array hosting config (multi-site)", () => {
    const json = JSON.stringify({
      hosting: [
        { target: "app", public: "dist" },
        { target: "admin", public: "admin/dist" },
      ],
    });
    const result = parseFirebaseHosting(json);
    expect(result.detected).toBe(true);
    expect(result.site).toBe("app");
    expect(result.publicDir).toBe("dist");
  });

  it("returns detected=false when no hosting config", () => {
    const json = JSON.stringify({ functions: { source: "functions" } });
    const result = parseFirebaseHosting(json);
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for invalid JSON", () => {
    const result = parseFirebaseHosting("not json");
    expect(result.detected).toBe(false);
  });

  it("handles hosting with no rewrites", () => {
    const json = JSON.stringify({
      hosting: { public: "public" },
    });
    const result = parseFirebaseHosting(json);
    expect(result.detected).toBe(true);
    expect(result.publicDir).toBe("public");
    expect(result.rewrites).toBe(false);
  });
});

// =============================================================================
// Framework detection
// =============================================================================

describe("detectHostingFramework", () => {
  it("detects React (via react-scripts)", () => {
    const pkg = JSON.stringify({ dependencies: { "react-scripts": "5.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("create-react-app");
  });

  it("detects Vite", () => {
    const pkg = JSON.stringify({ devDependencies: { vite: "^5.0.0", react: "^18.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("vite");
  });

  it("detects Next.js", () => {
    const pkg = JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("next");
  });

  it("detects Vue", () => {
    const pkg = JSON.stringify({ dependencies: { vue: "^3.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("vue");
  });

  it("detects Angular", () => {
    const pkg = JSON.stringify({ dependencies: { "@angular/core": "^17.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("angular");
  });

  it("detects SvelteKit", () => {
    const pkg = JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0" } });
    expect(detectHostingFramework(pkg)).toBe("sveltekit");
  });

  it("infers react from build dir", () => {
    const pkg = JSON.stringify({ dependencies: {} });
    expect(detectHostingFramework(pkg, "build")).toBe("react");
  });

  it("returns undefined when no framework detected", () => {
    const pkg = JSON.stringify({ dependencies: { express: "^4.0.0" } });
    expect(detectHostingFramework(pkg)).toBeUndefined();
  });

  it("handles invalid JSON", () => {
    expect(detectHostingFramework("not json")).toBeUndefined();
  });
});

// =============================================================================
// Firebase Hosting detection
// =============================================================================

describe("detectFirebaseHosting", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-fbhost-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from firebase.json with hosting config", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        hosting: { public: "dist", rewrites: [{ source: "**", destination: "/index.html" }] },
      }),
    );
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({ projects: { default: "my-project" } }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("firebase-hosting");
    expect(result!.kind).toBe("hosting");
    expect(result!.firebaseProject).toBe("my-project");
    expect(result!.publicDir).toBe("dist");
  });

  it("detects framework from package.json", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.framework).toBe("vite");
  });

  it("returns null when firebase.json has no hosting config", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ functions: { source: "functions" } }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("returns null when firebase.json does not exist", async () => {
    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("uses site target name when available", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { target: "app", public: "dist" } }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("app");
    expect(result!.site).toBe("app");
  });

  it("defaults name to 'hosting' when no target", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("hosting");
  });

  it("detects multi-site hosting (array)", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        hosting: [
          { target: "web", public: "dist" },
          { target: "admin", public: "admin/dist" },
        ],
      }),
    );

    const result = await detectFirebaseHosting(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("web");
    expect(result!.site).toBe("web");
  });
});

// =============================================================================
// Expo app.json parsing
// =============================================================================

describe("parseAppJson", () => {
  it("parses standard expo app.json", () => {
    const json = JSON.stringify({
      expo: {
        name: "MyApp",
        slug: "my-app",
        version: "1.0.0",
        ios: { bundleIdentifier: "com.example.myapp" },
        android: { package: "com.example.myapp" },
      },
    });
    const result = parseAppJson(json);
    expect(result.detected).toBe(true);
    expect(result.slug).toBe("my-app");
    expect(result.platform).toBe("both");
    expect(result.version).toBe("1.0.0");
  });

  it("detects iOS-only config", () => {
    const json = JSON.stringify({
      expo: {
        name: "iOSApp",
        slug: "ios-app",
        ios: { bundleIdentifier: "com.example.app" },
      },
    });
    const result = parseAppJson(json);
    expect(result.detected).toBe(true);
    expect(result.platform).toBe("ios");
  });

  it("detects android-only config", () => {
    const json = JSON.stringify({
      expo: {
        name: "AndroidApp",
        slug: "android-app",
        android: { package: "com.example.app" },
      },
    });
    const result = parseAppJson(json);
    expect(result.detected).toBe(true);
    expect(result.platform).toBe("android");
  });

  it("handles bare workflow (no expo wrapper)", () => {
    const json = JSON.stringify({
      name: "MyApp",
      slug: "my-app",
      version: "2.0.0",
    });
    const result = parseAppJson(json);
    expect(result.detected).toBe(true);
    expect(result.slug).toBe("my-app");
  });

  it("returns detected=false for empty config", () => {
    const json = JSON.stringify({});
    const result = parseAppJson(json);
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for invalid JSON", () => {
    const result = parseAppJson("not json");
    expect(result.detected).toBe(false);
  });
});

// =============================================================================
// EAS JSON parsing
// =============================================================================

describe("parseEasJson", () => {
  it("parses eas.json with production build profile", () => {
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
    const result = parseEasJson(json);
    expect(result.detected).toBe(true);
    expect(result.channel).toBe("production");
    expect(result.distribution).toBe("store");
  });

  it("detects ad-hoc distribution", () => {
    const json = JSON.stringify({
      build: {
        production: {
          distribution: "internal",
        },
      },
    });
    const result = parseEasJson(json);
    expect(result.detected).toBe(true);
    expect(result.distribution).toBe("ad-hoc");
  });

  it("defaults to ota distribution", () => {
    const json = JSON.stringify({
      build: {
        development: { developmentClient: true },
      },
    });
    const result = parseEasJson(json);
    expect(result.detected).toBe(true);
    expect(result.distribution).toBe("ota");
  });

  it("detects submit config", () => {
    const json = JSON.stringify({
      build: { production: {} },
      submit: { production: { ios: { appleId: "test@example.com" } } },
    });
    const result = parseEasJson(json);
    expect(result.detected).toBe(true);
    expect(result.hasSubmit).toBe(true);
  });

  it("returns detected=false when no build/submit config", () => {
    const json = JSON.stringify({ cli: { version: "3.0.0" } });
    const result = parseEasJson(json);
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for invalid JSON", () => {
    const result = parseEasJson("not json");
    expect(result.detected).toBe(false);
  });
});

// =============================================================================
// Publish command detection
// =============================================================================

describe("detectPublishCommand", () => {
  it("detects npm run publish script", () => {
    const pkg = JSON.stringify({
      scripts: { publish: "eas update --auto" },
    });
    expect(detectPublishCommand(pkg)).toBe("npm run publish");
  });

  it("detects ota script", () => {
    const pkg = JSON.stringify({
      scripts: { ota: "npx eas update --branch production" },
    });
    expect(detectPublishCommand(pkg)).toBe("npm run ota");
  });

  it("detects script containing eas update", () => {
    const pkg = JSON.stringify({
      scripts: { release: "eas update --auto --non-interactive" },
    });
    expect(detectPublishCommand(pkg)).toBe("npm run release");
  });

  it("returns undefined when no publish command found", () => {
    const pkg = JSON.stringify({
      scripts: { start: "node index.js", test: "vitest" },
    });
    expect(detectPublishCommand(pkg)).toBeUndefined();
  });

  it("handles invalid JSON", () => {
    expect(detectPublishCommand("not json")).toBeUndefined();
  });
});

// =============================================================================
// Expo/EAS detection
// =============================================================================

describe("detectExpoEAS", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-eas-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from app.json with expo config", async () => {
    await writeFile(
      join(tempDir, "app.json"),
      JSON.stringify({
        expo: {
          name: "Mtnmap",
          slug: "mtnmap",
          version: "2.3.1",
          ios: { bundleIdentifier: "com.example.mtnmap" },
        },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("expo-eas");
    expect(result!.kind).toBe("mobile");
    expect(result!.name).toBe("mtnmap");
    expect(result!.expoSlug).toBe("mtnmap");
    expect(result!.platform).toBe("ios");
  });

  it("detects from app.json + eas.json", async () => {
    await writeFile(
      join(tempDir, "app.json"),
      JSON.stringify({
        expo: {
          name: "MyApp",
          slug: "my-app",
          ios: {},
          android: {},
        },
      }),
    );
    await writeFile(
      join(tempDir, "eas.json"),
      JSON.stringify({
        build: {
          production: { channel: "production", distribution: "store" },
        },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.updateChannel).toBe("production");
    expect(result!.distribution).toBe("store");
    expect(result!.platform).toBe("both");
  });

  it("detects from app.config.ts + package.json with expo dep", async () => {
    await writeFile(join(tempDir, "app.config.ts"), `export default { name: "app" };`);
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-expo-app",
        dependencies: { expo: "^51.0.0" },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("expo-eas");
    expect(result!.name).toBe("my-expo-app");
  });

  it("detects from package.json with expo dependency only", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "expo-only",
        dependencies: { expo: "^51.0.0", "react-native": "^0.74.0" },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("expo-eas");
    expect(result!.name).toBe("expo-only");
  });

  it("detects custom publish command", async () => {
    await writeFile(
      join(tempDir, "app.json"),
      JSON.stringify({ expo: { name: "App", slug: "app" } }),
    );
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        scripts: { publish: "npm version patch && eas update --auto" },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.publishCommand).toBe("npm run publish");
  });

  it("returns null when no expo markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("returns null for empty directory", async () => {
    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("detects from eas.json alone (without app.json) + expo dep", async () => {
    await writeFile(
      join(tempDir, "eas.json"),
      JSON.stringify({ build: { production: { channel: "production" } } }),
    );
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "eas-only-app",
        dependencies: { expo: "^51.0.0" },
      }),
    );

    const result = await detectExpoEAS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.updateChannel).toBe("production");
  });
});

// =============================================================================
// Cloud detection integration — hosting & mobile adapters in Tier 4
// =============================================================================

describe("detectCloudServices (hosting & mobile)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-cloud-hostmobile-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects Firebase Hosting from firebase.json", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const hosting = result.configs.find((c) => c.provider === "firebase-hosting");
    expect(hosting).toBeDefined();
    expect(hosting!.kind).toBe("hosting");

    const evidence = result.evidence.find((e) => e.detectedAs === "cloud:firebase-hosting");
    expect(evidence).toBeDefined();
  });

  it("detects Expo/EAS from app.json", async () => {
    await writeFile(
      join(tempDir, "app.json"),
      JSON.stringify({ expo: { name: "App", slug: "app" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const mobile = result.configs.find((c) => c.provider === "expo-eas");
    expect(mobile).toBeDefined();
    expect(mobile!.kind).toBe("mobile");

    const evidence = result.evidence.find((e) => e.detectedAs === "cloud:expo-eas");
    expect(evidence).toBeDefined();
  });

  it("detects hosting alongside serverless and database services", async () => {
    // Mtnmap-like setup: Neon + CF Workers + Firebase Functions + Firebase Hosting + Expo
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n",
    );
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "api"\nroute = "api.example.com/*"`,
    );
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        functions: { source: "functions" },
        hosting: { public: "dist" },
      }),
    );
    await writeFile(
      join(tempDir, "app.json"),
      JSON.stringify({ expo: { name: "App", slug: "app", ios: {} } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    expect(result.configs.length).toBeGreaterThanOrEqual(5);

    const neon = result.configs.find((c) => c.provider === "neon");
    const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
    const fbFunctions = result.configs.find((c) => c.provider === "firebase-functions");
    const fbHosting = result.configs.find((c) => c.provider === "firebase-hosting");
    const expo = result.configs.find((c) => c.provider === "expo-eas");

    expect(neon).toBeDefined();
    expect(workers).toBeDefined();
    expect(fbFunctions).toBeDefined();
    expect(fbHosting).toBeDefined();
    expect(expo).toBeDefined();
  });

  it("detects Firebase Hosting alongside Firebase Functions from same firebase.json", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        functions: { source: "functions" },
        hosting: { public: "dist", target: "web" },
      }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const fbFunctions = result.configs.find((c) => c.provider === "firebase-functions");
    const fbHosting = result.configs.find((c) => c.provider === "firebase-hosting");

    expect(fbFunctions).toBeDefined();
    expect(fbHosting).toBeDefined();
    expect(fbHosting!.name).toBe("web");
  });

  it("returns no hosting or mobile when no markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-app", dependencies: {} }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const hosting = result.configs.filter((c) => c.kind === "hosting");
    const mobile = result.configs.filter((c) => c.kind === "mobile");
    expect(hosting).toHaveLength(0);
    expect(mobile).toHaveLength(0);
  });
});
