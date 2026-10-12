// Sidebar is the sole editor; profile data and guards belong to model-routing.
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { usePortalScopeProps } from "./lib/portal-scope";
import { cn } from "./lib/utils";

export const MODEL_ROUTING_PLUGIN_ID = "model-routing";
type Selection = { providerId: string; model: string; reasoningLevel: string };
type Policy = { mode: "adaptive" } | { mode: "inherit-session" } | { mode: "pool"; candidates: Selection[] };
type Profile = { orchestratorAllowed: Selection[] | null; workers: Policy; reviewers: Policy };
type RoleKey = keyof Profile;
type Overrides = Partial<Profile>;
export type Layers = { projectId: string | null; defaults: Profile; overrides: Overrides | null; effective: Profile };
type CatalogModel = { providerId: string; model: string; displayName: string; efforts: string[] };
type Warning = { code: string; role: string; message: string; missingReviewerProviders?:string[] };
const layersSchema = z.looseObject({projectId:z.string().nullable(), defaults:z.record(z.string(),z.unknown()),
  overrides:z.record(z.string(),z.unknown()).nullable(), effective:z.record(z.string(),z.unknown())}) as unknown as z.ZodType<Layers>;
const warningSchema = z.array(z.object({code:z.string(),role:z.string(),message:z.string(),missingReviewerProviders:z.array(z.string()).optional()}));
const rulesSchema = z.looseObject({version:z.literal(1),guards:z.array(z.object({code:z.string(),description:z.string()}))});
const ROLES = [
  {key:"orchestratorAllowed",title:"Coordinator",description:"Your chat model. Manual checks the allowed models."},
  {key:"workers",title:"Workers",description:"Write code and run tasks. Try models from left to right."},
  {key:"reviewers",title:"Reviewers",description:"Review and accept work using the other family."},
] as const;
const START: Selection = {providerId:"codex",model:"gpt-6.1-sol",reasoningLevel:"medium"};
const EFFORTS = [{id:"low",label:"Low"},{id:"medium",label:"Medium"},{id:"high",label:"High"},{id:"xhigh",label:"Extra high"},{id:"max",label:"Max"}];
const action = "inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";
const same = (a:Selection,b:Selection) => a.providerId===b.providerId && a.model===b.model && a.reasoningLevel===b.reasoningLevel;
function listOf(key:RoleKey,value:Profile[RoleKey]):Selection[]|null {
  if(key==="orchestratorAllowed") return value as Selection[]|null;
  return (value as Policy).mode==="pool" ? (value as {candidates:Selection[]}).candidates : null;
}
function fromList(key:RoleKey,list:Selection[]|null):Profile[RoleKey] {
  return key==="orchestratorAllowed" ? list : list===null ? {mode:"adaptive"} : {mode:"pool",candidates:list};
}
function equalRole(key:RoleKey,a:Profile[RoleKey],b:Profile[RoleKey]) {
  const x=listOf(key,a),y=listOf(key,b);
  if(x && y) return x.length===y.length && x.every((item,i)=>same(item,y[i]!));
  return JSON.stringify(a)===JSON.stringify(b);
}
export function withRole(overrides:Overrides,key:RoleKey,value:Profile[RoleKey]|undefined):Overrides {
  const {[key]:_dropped,...rest}=overrides;
  return value===undefined ? rest : {...rest,[key]:value};
}
export function normalizedRole(layers:Layers,key:RoleKey,value:Profile[RoleKey]|undefined):Profile[RoleKey]|undefined {
  return value!==undefined && equalRole(key,value,layers.defaults[key]) ? undefined : value;
}
function ModelChain({role,list,catalog,disabled,onChange}: {role:RoleKey;list:Selection[];catalog:CatalogModel[];disabled:boolean;onChange:(list:Selection[])=>void}) {
  const [editing,setEditing]=useState<number|null>(null);
  const [picker,setPicker]=useState(false);
  const display=(item:Selection)=>catalog.find(m=>m.providerId===item.providerId && m.model===item.model)?.displayName ?? item.model;
  const selected=editing===null ? undefined : list[editing];
  const update=(index:number,item:Selection)=>onChange(list.map((value,i)=>i===index?item:value));
  const move=(delta:number)=>{
    if(editing===null) return;
    const next=[...list], target=editing+delta;
    [next[editing],next[target]]=[next[target]!,next[editing]!];onChange(next);setEditing(target);
  };
  return <div className="mt-3 grid gap-2">
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Model chain">
      {list.map((item,index)=><span className="inline-flex items-center gap-1.5" key={`${item.providerId}/${item.model}/${index}`}>
        {index>0 ? <span aria-hidden="true" className="text-muted-foreground">→</span>:null}
        <button type="button" disabled={disabled} className={cn(action,"border border-border bg-background",editing===index && "ring-1 ring-foreground")} aria-expanded={editing===index}
          onClick={()=>{setEditing(editing===index?null:index);setPicker(false);}}>
          <span className="rounded px-1 text-muted-foreground">{item.providerId==="codex"?"G":"C"}</span>
          {display(item)} · {EFFORTS.find(e=>e.id===item.reasoningLevel)?.label ?? item.reasoningLevel}
        </button>
      </span>)}
      <button type="button" disabled={disabled} aria-label="Add model" aria-expanded={picker} className={cn(action,"border border-border")}
        onClick={()=>{setPicker(!picker);setEditing(null);}}>+</button>
    </div>
    {list.length===0?<p className="text-xs text-muted-foreground">Add a model, or switch to Auto.</p>:null}
    {selected && editing!==null ? <div className="grid gap-2 rounded-md bg-muted p-2">
      <div role="radiogroup" aria-label="Reasoning" className="flex flex-wrap gap-1">
        {EFFORTS.filter(e=>catalog.find(m=>m.providerId===selected.providerId && m.model===selected.model)?.efforts.includes(e.id)).map(e=><button type="button" role="radio" aria-checked={selected.reasoningLevel===e.id} disabled={disabled} key={e.id}
          className={cn(action,selected.reasoningLevel===e.id && "bg-background shadow-sm")} onClick={()=>update(editing,{...selected,reasoningLevel:e.id})}>{e.label}</button>)}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={action} disabled={disabled||editing===0} onClick={()=>move(-1)}>Move earlier</button>
        <button type="button" className={action} disabled={disabled||editing===list.length-1} onClick={()=>move(1)}>Move later</button>
        <button type="button" className={action} disabled={disabled} onClick={()=>{onChange(list.filter((_,i)=>i!==editing));setEditing(null);}}>Remove</button>
      </div>
    </div>:null}
    {picker ? <div className="grid gap-3 rounded-md bg-muted p-2" aria-label="Model picker">
      {[{id:"claude-code",title:"Claude"},{id:"codex",title:"GPT"}].map(provider=><div key={provider.id}>
        <p className="mb-1 text-xs font-medium">{provider.title}</p>
        <div className="flex flex-wrap gap-1">{catalog.filter(m=>m.providerId===provider.id && m.efforts.includes("high") && !list.some(item=>item.providerId===m.providerId && item.model===m.model) && !(role==="workers" && /haiku/i.test(m.model))).map(m=><button type="button" className={action} disabled={disabled} key={m.model}
          onClick={()=>{onChange([...list,{providerId:m.providerId,model:m.model,reasoningLevel:"high"}]);setEditing(list.length);setPicker(false);}}>{m.displayName}</button>)}</div>
      </div>)}
    </div>:null}
  </div>;
}

export function ProjectModelsPanel({projectId,onDone}: {projectId:string|null;onDone?:()=>void}) {
  const sdk=useSdk(),sdkRef=useRef(sdk);sdkRef.current=sdk;
  const [layers,setLayers]=useState<Layers|null>(null),[catalog,setCatalog]=useState<CatalogModel[]>([]);
  const [warnings,setWarnings]=useState<Warning[]>([]),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const [drafts,setDrafts]=useState<Partial<Record<RoleKey,Selection[]>>>({});
  const [rules,setRules]=useState<Array<{code:string;description:string}>>([]);
  const mounted=useRef(0),saveInFlight=useRef(false);
  const call=useCallback((method:string,input:Record<string,unknown>)=>sdkRef.current.plugins.callRpc({pluginId:MODEL_ROUTING_PLUGIN_ID,method,input:input as never,outputSchema:layersSchema}),[]);
  const warningCall=useCallback((id:string|null)=>sdkRef.current.plugins.callRpc({pluginId:MODEL_ROUTING_PLUGIN_ID,method:"getWarnings",input:{projectId:id} as never,outputSchema:warningSchema}),[]);
  const report=(cause:unknown)=>setError(cause instanceof Error?cause.message:"Model routing plugin is not installed or not running.");
  useEffect(()=>{
    const generation=++mounted.current;setLayers(null);setError(null);setPending(false);setDrafts({});saveInFlight.current=false;
    call("getLayers",{projectId}).then(next=>{if(generation===mounted.current)setLayers(next);},cause=>{if(generation===mounted.current)report(cause);});
    warningCall(projectId).then(next=>{if(generation===mounted.current)setWarnings(next);},cause=>{if(generation===mounted.current)report(cause);});
    sdkRef.current.plugins.callRpc({pluginId:MODEL_ROUTING_PLUGIN_ID,method:"getPolicyRules",input:{} as never,outputSchema:rulesSchema}).then(next=>{if(generation===mounted.current)setRules(next.guards);},cause=>{if(generation===mounted.current)report(cause);});
    Promise.allSettled(["claude-code","codex"].map(async providerId=>{
      const options=await sdkRef.current.system.executionOptions({providerId});
      if(options.modelLoadError)throw new Error(`${providerId}: ${options.modelLoadError.detail ?? options.modelLoadError.code}`);
      return options.models.map(m=>({providerId,model:m.model,displayName:m.displayName,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort)}));
    })).then(groups=>{
      if(generation!==mounted.current)return;
      setCatalog(groups.flatMap(group=>group.status==="fulfilled"?group.value:[]));
      const failure=groups.find(group=>group.status==="rejected");
      if(failure?.status==="rejected")report(failure.reason);
    });
    return ()=>{mounted.current++;};
  },[call,warningCall,projectId]);
  const save=(profile:Profile,overrides:Overrides)=>{
    if(!layers||saveInFlight.current)return;
    saveInFlight.current=true;
    const generation=mounted.current;setPending(true);
    const operation=layers.projectId===null?call("saveDefaults",{profile}):call("saveOverrides",{projectId:layers.projectId,overrides});
    operation.then(async next=>{
      if(generation!==mounted.current)return;
      setLayers(next);setError(null);
      try{const nextWarnings=await warningCall(next.projectId);if(generation===mounted.current)setWarnings(nextWarnings);}
      catch(cause){if(generation===mounted.current)report(cause);}
    },cause=>{if(generation===mounted.current)report(cause);}).finally(()=>{if(generation===mounted.current){saveInFlight.current=false;setPending(false);}});
  };
  const setRole=(key:RoleKey,value:Profile[RoleKey]|undefined)=>{
    if(!layers||saveInFlight.current)return;
    const list=value===undefined?null:listOf(key,value);
    if(list?.length===0){setDrafts(current=>({...current,[key]:[]}));return;}
    setDrafts(current=>{const {[key]:_dropped,...rest}=current;return rest;});
    save({...layers.defaults,[key]:value},withRole(layers.overrides??{},key,normalizedRole(layers,key,value)));
  };
  const manual=layers && ROLES.some(role=>listOf(role.key,layers.effective[role.key])!==null);
  return <div className="grid gap-4">
    <p className="text-xs leading-relaxed text-muted-foreground">Models for BB. Auto opens the pool; review guards still apply. Claude and Codex outside BB are not affected.</p>
    <p role="alert" className="text-xs text-destructive-text">{error}</p>
    {!layers?<p className="text-xs text-muted-foreground">Loading models…</p>:ROLES.map((role,index)=>{
      const value=layers.effective[role.key],list=drafts[role.key]??listOf(role.key,value),own=layers.projectId!==null && role.key in (layers.overrides??{});
      const inheritedSession=role.key!=="orchestratorAllowed" && (value as Policy).mode==="inherit-session";
      const mode=(enabled:boolean)=>{
        if((list!==null)===enabled)return;
        if(!enabled){setRole(role.key,fromList(role.key,null));return;}
        const defaults=listOf(role.key,layers.defaults[role.key]);
        setRole(role.key,defaults!==null?undefined:fromList(role.key,[{...START}]));
      };
      return <section key={role.key} aria-label={role.title} className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="text-muted-foreground">{index+1}</span>{role.title}
              {layers.projectId!==null?<span className="text-xs font-normal text-muted-foreground">{own?"Changed":"Default"}{own?<button type="button" className={action} disabled={pending} onClick={()=>setRole(role.key,undefined)}>Reset</button>:null}</span>:null}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{role.description}</p>
          </div>
          {!inheritedSession?<div role="radiogroup" aria-label={`${role.title} mode`} className="flex rounded-md bg-muted p-0.5">
            {["Auto","Manual"].map(label=><button key={label} type="button" role="radio" aria-checked={(list!==null)===(label==="Manual")} disabled={pending}
              className={cn(action,(list!==null)===(label==="Manual") && "bg-background shadow-sm")} onClick={()=>mode(label==="Manual")}>{label}</button>)}
          </div>:null}
        </div>
        {inheritedSession?<p className="mt-3 text-xs text-muted-foreground">Same as parent session</p>:list?<ModelChain role={role.key} list={list} catalog={catalog} disabled={pending} onChange={next=>setRole(role.key,fromList(role.key,next))}/>:<p className="mt-3 text-xs text-muted-foreground">{role.key==="orchestratorAllowed"?"Any model you pick in the chat. No warnings.":role.key==="workers"?"The pipeline and the models choose on their own.":"Chosen automatically. The pipeline still requires the other family."}</p>}
        {warnings.filter(w=>w.role===(role.key==="orchestratorAllowed"?"coordinator":role.key)).map((warning,i)=><div className="mt-2 text-xs text-destructive-text" key={`${warning.code}/${i}`}>
          <p>{warning.message}</p>
          {warning.code==="cross-family"?catalog.filter(m=>warning.missingReviewerProviders?.includes(m.providerId) && (m.model==="gpt-6.1-sol"||m.model==="claude-opus-5-5") && m.efforts.includes("high") && !(list??[]).some(item=>item.providerId===m.providerId && item.model===m.model)).map(m=><button key={m.model} type="button" className={action} disabled={pending}
            onClick={()=>setRole(role.key,fromList(role.key,[...(list??[]),{providerId:m.providerId,model:m.model,reasoningLevel:"high"}]))}>Add {m.displayName}</button>):null}
        </div>)}
      </section>;
    })}
    {layers?<div className="flex items-center justify-between gap-2">
      {manual?<button type="button" className={action} disabled={pending} onClick={()=>{
        setDrafts({});
        let next=layers.overrides??{};
        for(const role of ROLES)next=withRole(next,role.key,normalizedRole(layers,role.key,fromList(role.key,null)));
        save({orchestratorAllowed:null,workers:{mode:"adaptive"},reviewers:{mode:"adaptive"}},next);
      }}>Set all to Auto</button>:<span className="text-xs text-muted-foreground">All automatic · open pools</span>}
      {onDone?<button type="button" className={cn(action,"bg-primary px-3 text-primary-foreground hover:bg-primary/90")} disabled={pending||Object.keys(drafts).length>0} onClick={onDone}>Done</button>:null}
    </div>:null}
    {Object.keys(drafts).length>0?<p className="text-xs text-muted-foreground">Add a model or switch to Auto to save the empty chain.</p>:null}
    <p className="sr-only">{rules.map(rule=>rule.description).join(". ")}</p>
  </div>;
}
export function ProjectModelsDialog({projectId,projectName,open,onOpenChange}: {projectId:string|null;projectName:string;open:boolean;onOpenChange:(open:boolean)=>void}) {
  const portalScope=usePortalScopeProps(),[scope,setScope]=useState(projectId);
  useEffect(()=>{if(open)setScope(projectId);},[open,projectId]);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay {...portalScope} className="fixed inset-0 z-50 bg-black/40"/>
    <Dialog.Content {...portalScope} className="fixed left-1/2 top-1/2 z-50 box-border max-h-[85vh] w-[calc(100%_-_2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
      <div className="mb-3 flex items-center justify-between gap-2"><Dialog.Title className="text-sm font-semibold">Models</Dialog.Title>
        <div role="tablist" aria-label="Models scope" className="flex rounded-md bg-muted p-0.5">
          {projectId!==null?<button type="button" role="tab" aria-selected={scope===projectId} className={cn(action,scope===projectId&&"bg-background shadow-sm")} onClick={()=>setScope(projectId)}>{projectName}</button>:null}
          <button type="button" role="tab" aria-selected={scope===null} className={cn(action,scope===null&&"bg-background shadow-sm")} onClick={()=>setScope(null)}>All projects</button>
        </div>
        <Dialog.Close className={action} aria-label="Close Models"><HugeiconsIcon icon={Cancel01Icon} className="size-4"/></Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{scope===null?"Defaults every project inherits.":"Changes apply to this project only."}</Dialog.Description>
      {open?<ProjectModelsPanel key={scope??"defaults"} projectId={scope} onDone={()=>onOpenChange(false)}/>:null}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
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
