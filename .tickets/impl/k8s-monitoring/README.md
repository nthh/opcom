---
id: k8s-monitoring
title: "Kubernetes Infrastructure Monitoring"
status: closed
type: feature
priority: 3
deps:
  - phase-3-server
links:
  - docs/spec/infrastructure.md
services:
  - core
  - cli
---

# Kubernetes Infrastructure Monitoring

## Goal

Monitor live Kubernetes cluster state for projects with K8s infrastructure — deployments, pods, services, and their health. Uses `kubectl` CLI for maximum compatibility with existing cluster auth (kubeconfig, cloud provider plugins). Designed around the `InfraAdapter` interface so other runtimes (ECS, Fly.io) can be added later.

## Tasks

- [ ] Define `InfraAdapter` interface: `detect`, `listResources`, `getResource`, `streamLogs`, `watch`
- [ ] Define normalized types: `InfraResource`, `PodDetail`, `ContainerStatus`, `ResourceStatus`, `ReplicaStatus`
- [ ] Implement `KubernetesAdapter`:
  - [ ] Detection: check `StackInfo.infrastructure` for kubernetes, or kubeconfig context matching project name
  - [ ] Project-to-resource mapping: label matching (`app=<project>`), namespace matching, or explicit user config
  - [ ] `kubectl get` JSON output parsing for deployments, pods, services, ingresses
  - [ ] Status mapping: K8s conditions → `ResourceStatus` (healthy/degraded/unhealthy/progressing/suspended)
  - [ ] Pod detail: container status, restart counts, crash reasons (CrashLoopBackOff, OOMKilled)
- [ ] Log streaming: `kubectl logs --follow` as `AsyncIterable<LogLine>`
- [ ] Watch mode: `kubectl get --watch -o json` for real-time resource updates
- [ ] Polling fallback: 30s interval if watch stream drops
- [ ] REST endpoints: `/projects/:id/infrastructure`, `/:resourceId`, `/:resourceId/logs`, `/:resourceId/restart`
- [ ] WebSocket events: `infra_resource_updated`, `infra_resource_deleted`, `pod_crash`
- [ ] CLI: `opcom infra [project]` for infrastructure overview
- [ ] CLI: `opcom infra <project> logs <pod> [--follow]` for log tailing
- [ ] CLI: `opcom infra <project> restart <deployment>` for rollout restart
- [ ] User config: kubeconfig context, namespace, label selector overrides per project
- [ ] TUI L1: infrastructure health indicator per project (●●○ K8s)
- [ ] TUI L2: INFRASTRUCTURE section with deployments, services, pods and live status
- [ ] TUI L3: Pod detail view with container status and log streaming
- [ ] Crash alerts: surface `pod_crash` events as TUI notifications

## Acceptance Criteria

- `opcom infra folia` shows all K8s resources associated with the folia project
- Pod crashes surface immediately in the TUI with the crash reason
- Log streaming works for multi-container pods with container switching
- Works with standard kubeconfig auth including cloud provider plugins (gke-gcloud-auth-plugin, aws-iam-authenticator)
- Resources are correctly mapped to projects via labels or namespace
- Rollout restart triggers a new deployment rollout and shows progressing status
