// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ callRpc: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSdk: () => ({ plugins: { callRpc: mocks.callRpc } }),
  experimental_ProviderModelPicker: () => null,
}));
import { ProjectModelsPanel, type Layers } from "./ProjectModelsDialog";

const opus = { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high" };
const sol = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium" };
const defaults = {
  orchestratorAllowed: null,
  workers: { mode: "pool" as const, candidates: [opus, sol] },
  reviewers: { mode: "adaptive" as const },
};
let layers: Layers;

beforeEach(() => {
  layers = {
    projectId: "proj_1",
    defaults,
    overrides: { workers: { mode: "pool", candidates: [sol] }, reviewers: { mode: "pool", candidates: [opus] } },
    effective: { ...defaults, workers: { mode: "pool", candidates: [sol] }, reviewers: { mode: "pool", candidates: [opus] } },
  };
  mocks.callRpc.mockReset().mockImplementation(async () => layers);
});
afterEach(cleanup);

async function show(projectId: string | null) {
  await act(async () => {
    render(<ProjectModelsPanel projectId={projectId} />);
  });
}

describe("project models panel", () => {
  it("reads the project's layers from the model-routing plugin", async () => {
    await show("proj_1");
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "model-routing", method: "getLayers", input: { projectId: "proj_1" },
    }));
    expect(screen.getByText("Default: Any model")).toBeTruthy();
  });

  it("Use default drops only that role of this project", async () => {
    await show("proj_1");
    const workers = screen.getByRole("region", { name: "Workers" });
    await act(async () => {
      fireEvent.click(workers.querySelector("button")!);
    });
    expect(mocks.callRpc).toHaveBeenLastCalledWith(expect.objectContaining({
      pluginId: "model-routing",
      method: "saveOverrides",
      input: { projectId: "proj_1", overrides: { reviewers: { mode: "pool", candidates: [opus] } } },
    }));
  });

  it("edits the defaults when no project is given", async () => {
    layers = { projectId: null, defaults, overrides: null, effective: defaults };
    await show(null);
    expect(screen.queryByText("Use default")).toBeNull();
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Workers" }), { target: { value: "open" } });
    });
    expect(mocks.callRpc).toHaveBeenLastCalledWith(expect.objectContaining({
      method: "saveDefaults",
      input: { profile: { ...defaults, workers: { mode: "adaptive" } } },
    }));
  });

  it("says so when the model-routing plugin is missing", async () => {
    mocks.callRpc.mockReset().mockRejectedValue("not found");
    await show("proj_1");
    expect(screen.getByRole("alert").textContent).toMatch(/not installed/);
  });
});
