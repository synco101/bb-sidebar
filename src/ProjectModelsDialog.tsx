// Alexander's fork: per-project model settings opened from the sidebar.
// The data belongs to the separate `model-routing` plugin; this file only
// reads and saves it through that plugin's RPC, so the settings and the dev
// pipeline keep working if this fork is replaced by upstream bb-sidebar.
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Cancel01Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useSdk,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { usePortalScopeProps } from "./lib/portal-scope";
import { cn } from "./lib/utils";

export const MODEL_ROUTING_PLUGIN_ID = "model-routing";

type Selection = { providerId: string; model: string; reasoningLevel: string };
type Policy = { mode: "adaptive" } | { mode: "inherit-session" } | { mode: "pool"; candidates: Selection[] };
type Profile = { orchestratorAllowed: Selection[] | null; workers: Policy; reviewers: Policy };
type RoleKey = keyof Profile;
type Overrides = Partial<Profile>;
export type Layers = {
  projectId: string | null;
  defaults: Profile;
  overrides: Overrides | null;
  effective: Profile;
};

// Shape check only; the model-routing plugin validates every save itself.
const layersSchema = z
  .looseObject({
    projectId: z.string().nullable(),
    defaults: z.record(z.string(), z.unknown()),
    overrides: z.record(z.string(), z.unknown()).nullable(),
    effective: z.record(z.string(), z.unknown()),
  }) as unknown as z.ZodType<Layers>;

const ROLES: ReadonlyArray<{ key: RoleKey; title: string; description: string }> = [
  { key: "orchestratorAllowed", title: "Coordinator", description: "Chosen in the chat as usual. The pipeline only warns when it is not in this list." },
  { key: "workers", title: "Workers", description: "Threads that write code and run bounded tasks. The first model is tried first." },
  { key: "reviewers", title: "Reviewers", description: "Threads that review and accept work. A reviewer of another model family is always required." },
];

const START: Selection = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium" };
const label = (s: Selection) => `${s.model} · ${s.reasoningLevel}`;
const same = (a: Selection, b: Selection) =>
  a.providerId === b.providerId && a.model === b.model && a.reasoningLevel === b.reasoningLevel;

function listOf(key: RoleKey, value: Profile[RoleKey]): Selection[] | null {
  if (key === "orchestratorAllowed") return value as Selection[] | null;
  const policy = value as Policy;
  return policy.mode === "pool" ? policy.candidates : null;
}

function fromList(key: RoleKey, list: Selection[] | null): Profile[RoleKey] {
  if (key === "orchestratorAllowed") return list;
  return list === null ? { mode: "adaptive" } : { mode: "pool", candidates: list };
}

function summary(key: RoleKey, value: Profile[RoleKey]): string {
  const list = listOf(key, value);
  if (list) return list.map(label).join(", ");
  if (key === "orchestratorAllowed") return "Any model";
  return (value as Policy).mode === "adaptive" ? "As today (pipeline decides)" : "Same as parent session";
}

/** The overrides with one role set, or dropped so it follows the defaults. */
export function withRole(overrides: Overrides, key: RoleKey, value: Profile[RoleKey] | undefined): Overrides {
  const { [key]: _dropped, ...rest } = overrides;
  return value === undefined ? rest : { ...rest, [key]: value };
}

const buttonClass =
  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40";

function ModelList({ list, onChange }: { list: Selection[]; onChange: (next: Selection[] | null) => void }) {
  const [draft, setDraft] = useState<ExperimentalProviderModelPickerValue>(START as ExperimentalProviderModelPickerValue);
  const move = (index: number) => {
    const next = [...list];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    onChange(next);
  };
  const add = () => {
    const selection = { providerId: draft.providerId, model: draft.model, reasoningLevel: draft.reasoningLevel };
    if (!list.some((item) => same(item, selection))) onChange([...list, selection]);
  };
  return (
    <div className="mt-2 grid gap-1">
      <ol className="divide-y divide-border rounded-md border border-border">
        {list.map((item, index) => (
          <li key={`${item.providerId}/${item.model}/${item.reasoningLevel}`} className="flex items-center gap-1 px-2 py-1 text-xs">
            <span className="w-4 text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate">
              {label(item)} <span className="text-muted-foreground">({item.providerId})</span>
            </span>
            <button type="button" className={buttonClass} disabled={index === 0} aria-label="Move up" onClick={() => move(index)}>
              <HugeiconsIcon icon={ArrowUp01Icon} className="size-3.5" />
            </button>
            <button type="button" className={buttonClass} aria-label="Remove"
              onClick={() => onChange(list.length === 1 ? null : list.filter((_, i) => i !== index))}>
              <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <ProviderModelPicker value={draft} onChange={setDraft} />
        <button type="button" className={cn(buttonClass, "border border-border")} onClick={add}>Add</button>
      </div>
    </div>
  );
}

function RoleBlock({ role, layers, onSet }: {
  role: (typeof ROLES)[number];
  layers: Layers;
  onSet: (value: Profile[RoleKey] | undefined) => void;
}) {
  const isProject = layers.projectId !== null;
  const own = isProject && layers.overrides !== null && role.key in layers.overrides;
  const list = listOf(role.key, layers.effective[role.key]);
  return (
    <section aria-label={role.title} className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{role.title}</h3>
          <p className="text-xs text-muted-foreground">{role.description}</p>
        </div>
        {own ? <button type="button" className={buttonClass} onClick={() => onSet(undefined)}>Use default</button> : null}
      </div>
      {isProject && !own ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Default: {summary(role.key, layers.defaults[role.key])}</p>
      ) : null}
      <select
        aria-label={role.title}
        className="mt-2 h-8 rounded-md border border-border bg-background px-2 text-xs"
        value={list ? "list" : "open"}
        onChange={(event) => onSet(fromList(role.key, event.target.value === "list" ? [{ ...START }] : null))}
      >
        <option value="open">{role.key === "orchestratorAllowed" ? "Any model" : "As today (pipeline decides)"}</option>
        <option value="list">Only these models, in this order</option>
      </select>
      {list ? <ModelList list={list} onChange={(next) => onSet(fromList(role.key, next))} /> : null}
    </section>
  );
}

/** The three role blocks for one project, or for the defaults when projectId is null. */
export function ProjectModelsPanel({ projectId }: { projectId: string | null }) {
  const sdk = useSdk();
  const [layers, setLayers] = useState<Layers | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so a new sdk object per render cannot re-trigger the load.
  const sdkRef = useRef(sdk);
  sdkRef.current = sdk;
  const call = useCallback(
    (method: string, input: Record<string, unknown>) =>
      sdkRef.current.plugins.callRpc({ pluginId: MODEL_ROUTING_PLUGIN_ID, method, input: input as never, outputSchema: layersSchema }),
    [],
  );
  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : "Model routing plugin is not installed or not running.");

  useEffect(() => {
    let canceled = false;
    setLayers(null);
    call("getLayers", { projectId }).then((next) => { if (!canceled) { setLayers(next); setError(null); } },
      (cause) => { if (!canceled) report(cause); });
    return () => { canceled = true; };
  }, [call, projectId]);

  const setRole = (key: RoleKey, value: Profile[RoleKey] | undefined) => {
    if (layers === null) return;
    const save = layers.projectId === null
      ? call("saveDefaults", { profile: { ...layers.defaults, [key]: value } })
      : call("saveOverrides", { projectId: layers.projectId, overrides: withRole(layers.overrides ?? {}, key, value) });
    save.then((next) => { setLayers(next); setError(null); }, report);
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Used by the dev pipeline inside BB only. Claude and Codex in a terminal or in their own apps are not affected.
      </p>
      {error ? <p role="alert" className="text-xs text-destructive-text">{error}</p> : null}
      {layers === null ? null : ROLES.map((role) => (
        <RoleBlock key={role.key} role={role} layers={layers} onSet={(value) => setRole(role.key, value)} />
      ))}
    </div>
  );
}

export function ProjectModelsDialog({ projectId, projectName, open, onOpenChange }: {
  projectId: string | null;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const portalScope = usePortalScopeProps();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay {...portalScope} className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content {...portalScope}
          className="fixed left-1/2 top-1/2 z-50 box-border max-h-[85vh] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
          <Dialog.Title className="text-sm font-semibold">Models · {projectName}</Dialog.Title>
          <Dialog.Description className="mb-3 mt-1 text-xs text-muted-foreground">
            {projectId === null ? "Defaults every project inherits." : "Changes apply to this project only."}
          </Dialog.Description>
          {open ? <ProjectModelsPanel projectId={projectId} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Gear button that opens the models dialog. */
export function ProjectModelsButton({ projectId, projectName, className }: {
  projectId: string | null;
  projectName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Models for ${projectName}`} title="Models"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring", className)}>
        <HugeiconsIcon icon={Settings02Icon} className="size-3.5" />
      </button>
      <ProjectModelsDialog projectId={projectId} projectName={projectName} open={open} onOpenChange={setOpen} />
    </>
  );
}
