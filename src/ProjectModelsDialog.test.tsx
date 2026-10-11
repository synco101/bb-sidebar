// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ callRpc: vi.fn(), executionOptions: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSdk: () => ({ plugins: { callRpc: mocks.callRpc }, system: { executionOptions: mocks.executionOptions } }),
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
  mocks.executionOptions.mockReset().mockImplementation(async ({providerId}) => ({modelLoadError:null,models:[opus,sol].filter(item=>item.providerId===providerId).map(item=>({...item,displayName:item===opus?"Opus 5.5":"GPT-6.1-Sol",supportedReasoningEfforts:["low","medium","high","xhigh","max"].map(reasoningEffort=>({reasoningEffort}))}))}));
  mocks.callRpc.mockReset().mockImplementation(async ({method}) => method==="getWarnings" ? [] : method==="getPolicyRules" ? {version:1,guards:[]} : layers);
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
    expect(within(screen.getByRole("region", {name:"Coordinator"})).getByText("Default")).toBeTruthy();
  });

  it("Reset drops only that role of this project", async () => {
    await show("proj_1");
    const workers = screen.getByRole("region", { name: "Workers" });
    await act(async () => {
      fireEvent.click(within(workers).getByRole("button", {name:"Reset"}));
    });
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "model-routing",
      method: "saveOverrides",
      input: { projectId: "proj_1", overrides: { reviewers: { mode: "pool", candidates: [opus] } } },
    }));
  });

  it("edits the defaults when no project is given", async () => {
    layers = { projectId: null, defaults, overrides: null, effective: defaults };
    await show(null);
    expect(screen.queryByText("Reset")).toBeNull();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", {name:"Workers"})).getByRole("radio", {name:"Auto"}));
    });
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: "saveDefaults",
      input: { profile: { ...defaults, workers: { mode: "adaptive" } } },
    }));
  });

  it("says so when the model-routing plugin is missing", async () => {
    mocks.callRpc.mockReset().mockRejectedValue("not found");
    await show("proj_1");
    expect(screen.getByRole("alert").textContent).toMatch(/not installed/);
  });
  it("drops a project override when Auto equals defaults", async () => {
    await show("proj_1");
    await act(async()=>fireEvent.click(within(screen.getByRole("region",{name:"Reviewers"})).getByRole("radio",{name:"Auto"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{workers:layers.overrides!.workers}}}));
  });

  it("Manual inherits a manual default chain", async () => {
    layers.effective.workers={mode:"adaptive"};
    layers.overrides!.workers={mode:"adaptive"};
    await show("proj_1");
    await act(async()=>fireEvent.click(within(screen.getByRole("region",{name:"Workers"})).getByRole("radio",{name:"Manual"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{reviewers:layers.overrides!.reviewers}}}));
  });

  it("sets all to Auto in one project save and drops matching defaults", async () => {
    await show("proj_1");
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Set all to Auto"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{workers:{mode:"adaptive"}}}}));
  });

  it("sets all default roles to Auto", async () => {
    layers={projectId:null,defaults,overrides:null,effective:defaults};
    await show(null);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Set all to Auto"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveDefaults",input:{profile:{orchestratorAllowed:null,workers:{mode:"adaptive"},reviewers:{mode:"adaptive"}}}}));
  });

  it("preserves inherit-session read-only", async () => {
    layers.effective={...layers.effective,workers:{mode:"inherit-session"}};
    await show("proj_1");
    expect(within(screen.getByRole("region",{name:"Workers"})).queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Same as parent session")).toBeTruthy();
  });

  it("shows cross-family warning and fix only when plugin reports broken config", async () => {
    mocks.callRpc.mockImplementation(async({method})=>method==="getWarnings"?[{code:"cross-family",role:"reviewers",message:"No GPT reviewer for code by Opus 5.5. Runs will stop at review."}]:method==="getPolicyRules"?{version:1,guards:[]}:layers);
    await show("proj_1");
    expect(screen.getByText(/No GPT reviewer/)).toBeTruthy();
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Add GPT-6.1-Sol"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{...layers.overrides,reviewers:{mode:"pool",candidates:[opus,{...sol,reasoningLevel:"high"}]}}}}));
  });

  it("keeps a valid configuration quiet", async () => {
    await show("proj_1");
    expect(screen.queryByRole("button",{name:/Add GPT/})).toBeNull();
  });

  it("opens chip effort editor and keeps empty Manual after removal", async () => {
    await show("proj_1");
    const workers=within(screen.getByRole("region",{name:"Workers"}));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:/GPT-6.1-Sol/})));
    await act(async()=>fireEvent.click(workers.getByRole("radio",{name:"High"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{...layers.overrides,workers:{mode:"pool",candidates:[{...sol,reasoningLevel:"high"}]}}}}));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:"Remove"})));
    expect(screen.getByText("Add a model, or switch to Auto.")).toBeTruthy();
    expect(mocks.callRpc).not.toHaveBeenCalledWith(expect.objectContaining({method:"saveOverrides",input:{projectId:"proj_1",overrides:{...layers.overrides,workers:{mode:"pool",candidates:[]}}}}));
  });

  it("moves a chip in both directions and hides selected/Haiku picker entries", async () => {
    layers={projectId:null,defaults,overrides:null,effective:defaults};
    mocks.executionOptions.mockImplementation(async({providerId})=>({modelLoadError:null,models:[opus,sol,{providerId:"claude-code",model:"claude-haiku-5-5",reasoningLevel:"high"}].filter(item=>item.providerId===providerId).map(item=>({...item,displayName:item.model.includes("haiku")?"Haiku 5.5":item===opus?"Opus 5.5":"GPT-6.1-Sol",supportedReasoningEfforts:[{reasoningEffort:"high"},{reasoningEffort:"medium"}]}))}));
    mocks.callRpc.mockImplementation(async({method,input})=>{
      if(method==="getWarnings")return [];
      if(method==="getPolicyRules")return {version:1,guards:[]};
      if(method==="saveDefaults")layers={projectId:null,defaults:input.profile,overrides:null,effective:input.profile};
      return layers;
    });
    await show(null);
    const workers=within(screen.getByRole("region",{name:"Workers"}));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:/GPT-6.1-Sol/})));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:"Move earlier"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveDefaults",input:{profile:{...defaults,workers:{mode:"pool",candidates:[sol,opus]}}}}));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:"Move later"})));
    expect(mocks.callRpc).toHaveBeenCalledWith(expect.objectContaining({method:"saveDefaults",input:{profile:defaults}}));
    await act(async()=>fireEvent.click(workers.getByRole("button",{name:"Add model"})));
    expect(workers.queryByRole("button",{name:"Haiku 5.5"})).toBeNull();
    expect(workers.queryByRole("button",{name:"Opus 5.5"})).toBeNull();
  });

  it("does not reset a custom chain when its selected Manual segment is clicked", async () => {
    await show("proj_1");
    await act(async()=>fireEvent.click(within(screen.getByRole("region",{name:"Workers"})).getByRole("radio",{name:"Manual"})));
    expect(mocks.callRpc.mock.calls.filter(([call])=>call.method.startsWith("save"))).toHaveLength(0);
  });

});
