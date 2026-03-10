import { describe, it, expect } from "vitest";
import type { ClientCommand, ServerEvent, EnvironmentStatus } from "@opcom/types";

// Test the type definitions for environment commands
describe("station environment types", () => {
  it("start_services command accepts projectId", () => {
    const cmd: ClientCommand = { type: "start_services", projectId: "folia" };
    expect(cmd.type).toBe("start_services");
    expect(cmd.projectId).toBe("folia");
  });

  it("start_services command accepts optional serviceName", () => {
    const cmd: ClientCommand = { type: "start_services", projectId: "folia", serviceName: "api" };
    expect(cmd.type).toBe("start_services");
    expect(cmd.serviceName).toBe("api");
  });

  it("stop_services command accepts projectId", () => {
    const cmd: ClientCommand = { type: "stop_services", projectId: "folia" };
    expect(cmd.type).toBe("stop_services");
  });

  it("stop_services command accepts optional serviceName", () => {
    const cmd: ClientCommand = { type: "stop_services", projectId: "folia", serviceName: "api" };
    expect(cmd.type).toBe("stop_services");
    expect(cmd.serviceName).toBe("api");
  });

  it("restart_service command requires serviceName", () => {
    const cmd: ClientCommand = { type: "restart_service", projectId: "folia", serviceName: "api" };
    expect(cmd.type).toBe("restart_service");
    expect(cmd.serviceName).toBe("api");
  });

  it("service_status event contains service instance", () => {
    const event: ServerEvent = {
      type: "service_status",
      projectId: "folia",
      service: {
        serviceName: "api",
        projectId: "folia",
        pid: 12345,
        port: 3000,
        state: "running",
        startedAt: new Date().toISOString(),
        restartCount: 0,
      },
    };
    expect(event.type).toBe("service_status");
  });

  it("environment_status event contains aggregate status", () => {
    const status: EnvironmentStatus = {
      projectId: "folia",
      state: "all-up",
      services: [
        {
          serviceName: "api",
          projectId: "folia",
          pid: 12345,
          port: 3000,
          state: "running",
          startedAt: new Date().toISOString(),
          restartCount: 0,
        },
      ],
      ports: [3000],
      upSince: new Date().toISOString(),
    };

    const event: ServerEvent = {
      type: "environment_status",
      projectId: "folia",
      status,
    };
    expect(event.type).toBe("environment_status");
  });

  it("ProjectStatusSnapshot includes optional environmentStatus", () => {
    const snapshot = {
      id: "folia",
      name: "folia",
      path: "/projects/folia",
      git: null,
      workSummary: null,
      environmentStatus: {
        projectId: "folia",
        state: "all-up" as const,
        services: [],
        ports: [],
      },
    };
    expect(snapshot.environmentStatus.state).toBe("all-up");
  });
});
