---
id: cloud-hosting-mobile-adapters
title: "Cloud Hosting & Mobile Adapters: Firebase Hosting, Expo/EAS OTA"
status: closed
type: feature
priority: 3
deps:
  - cloud-serverless-adapters
links:
  - docs/spec/cloud-services.md
services:
  - core
  - cli
---

# Cloud Hosting & Mobile Adapters: Firebase Hosting, Expo/EAS OTA

## Goal

Track hosting deployment status (Firebase Hosting — deployed ref, domains, SSL) and mobile OTA version/publish state (Expo/EAS). Users see "what's deployed where" and can trigger deploys or publishes from TUI/CLI.

Benchmarked against: Mtnmap (Firebase Hosting for web app + iOS OTA via npm publish).

## Tasks

- [ ] Implement `FirebaseHostingAdapter`:
  - [ ] Detection: `firebase.json` with `hosting` config, `.firebaserc`
  - [ ] Status: Firebase Hosting API for current release, domains, preview channels
  - [ ] Deploy: `firebase deploy --only hosting`
  - [ ] Auth: `firebase login`
- [ ] Implement `ExpoEASAdapter`:
  - [ ] Detection: `app.json`/`app.config.ts` with expo config, `eas.json`
  - [ ] Status: `eas update:list --json` for OTA updates, `eas build:list --json` for builds
  - [ ] Publish: configurable publish command (default: `eas update --auto`)
  - [ ] Auth: `eas login` or `EXPO_TOKEN`
- [ ] Define `HostingDetail`, `DomainInfo`, `MobileDetail` types
- [ ] CLI: `opcom deploy <project> hosting` — deploy to Firebase Hosting
- [ ] CLI: `opcom publish <project>` — publish OTA update
- [ ] L2 HOSTING section: deployed ref, domains, SSL status
- [ ] L2 MOBILE section: current version, last published, channel

## Acceptance Criteria

- `opcom cloud mtnmap` shows Firebase Hosting (domain, deployed ref, last deploy time) and iOS OTA (version, publish date, channel)
- `opcom publish mtnmap` triggers OTA publish and shows version
- `opcom deploy mtnmap hosting` triggers Firebase Hosting deploy
