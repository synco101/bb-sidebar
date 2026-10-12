import { useCallback,useEffect,useRef,useState } from "react";
import { useSdk,useBbNavigate,experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { launchSchema,launchForest,mergeLaunches,sdkLaunches,type JournalLaunch,type LaunchRow } from "./launch-tree";

export function LaunchTree({threadId}:{threadId:string}) {
  const sdk=useSdk(),navigate=useBbNavigate(),{threads}=useSidebarThreads();
  const [open,setOpen]=useState(false),[rows,setRows]=useState<LaunchRow[]>([]),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<LaunchRow|null>(null);
  const generation=useRef(0),loading=useRef(false),dirty=useRef(false),alive=useRef(false);
  const host=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(typeof IntersectionObserver==="undefined"),[foreground,setForeground]=useState(!document.hidden);
  const enabled=useRef(false);enabled.current=open && visible && foreground;
  const cache=useRef(new Map<string,{journal:Map<string,JournalLaunch>;sdk:Map<string,LaunchRow>;revision:number;initialized:boolean;journalInitialized:boolean;maxSeq?:number}>());
  const sdkRef=useRef(sdk);sdkRef.current=sdk;
  const load=useCallback(async()=>{
    if(!enabled.current || !alive.current)return;
    if(loading.current){dirty.current=true;return;}
    loading.current=true;const stamp=generation.current;
    try {
      const family=threads.filter(thread=>thread.parentThreadId===threadId);
      const visited=new Set([threadId,...family.map(thread=>thread.id)]);
      for(let index=0;index<family.length;index++){
        for(const child of threads.filter(thread=>thread.parentThreadId===family[index].id)){
          if(!visited.has(child.id)){visited.add(child.id);family.push(child);}
        }
      }
      const journal:JournalLaunch[]=[],sdkRows:LaunchRow[]=[],bb:LaunchRow[]=[],failures:string[]=[];
      for(const current of [threadId,...family.map(thread=>thread.id)]){
        if(!enabled.current || !alive.current || stamp!==generation.current)return;
        const parent=current===threadId?null:current;
        let saved=cache.current.get(current);
        if(!saved){saved={journal:new Map(),sdk:new Map(),revision:0,initialized:false,journalInitialized:false};cache.current.set(current,saved);}
        try {
          if(!saved.journalInitialized){
            for(let offset=0;;offset+=1000){
              const batch=await sdkRef.current.plugins.callRpc({pluginId:"model-routing",method:"listLaunches",input:{threadId:current,offset,limit:1000},outputSchema:z.array(launchSchema)});
              batch.forEach(row=>saved!.journal.set(row.id,{...row,parentId:row.parentId??parent}));if(batch.length<1000)break;
            }
          }
          saved.journalInitialized=true;
          for(;;){
            const delta=await sdkRef.current.plugins.callRpc({pluginId:"model-routing",method:"listLaunchChanges",input:{threadId:current,afterRevision:saved.revision,limit:1000},outputSchema:z.object({revision:z.number(),rows:z.array(launchSchema),hasMore:z.boolean()})});
            delta.rows.forEach(row=>saved!.journal.set(row.id,{...row,parentId:row.parentId??parent}));
            if(delta.hasMore && delta.revision<=saved.revision)throw new Error("Journal revision did not advance");
            saved.revision=delta.revision;if(!delta.hasMore)break;
          }
        }catch(cause){failures.push(`journal unavailable (${cause instanceof Error?cause.message:"RPC error"})`);}
        journal.push(...saved.journal.values());
        try {
          let timeline=await sdkRef.current.threads.timeline({threadId:current,includeNestedRows:"true",segmentLimit:"100",...(saved.maxSeq===undefined?{}:{afterSequence:String(saved.maxSeq)})});
          const newestSeq=timeline.maxSeq;
          const collect=()=>sdkLaunches([...timeline.rows,...timeline.activeBackgroundCommands,...(timeline.timelinePage.olderRowUpdates??[])],current,parent).forEach(row=>saved!.sdk.set(row.id,row));
          collect();const cursors=new Set<string>();
          // Only the first load pages history. Subsequent reads reconcile newest rows/updates with the cache.
          while(!saved.initialized && timeline.timelinePage.hasOlderRows){
            if(!enabled.current || !alive.current || stamp!==generation.current)return;
            const cursor=timeline.timelinePage.olderCursor;
            if(!cursor || cursors.has(cursor.anchorId)){failures.push("SDK history cursor unavailable");break;}
            cursors.add(cursor.anchorId);
            timeline=await sdkRef.current.threads.timeline({threadId:current,includeNestedRows:"true",segmentLimit:"100",beforeAnchorId:cursor.anchorId,beforeAnchorSeq:String(cursor.anchorSeq)});
            collect();
          }
          if(typeof newestSeq==="number")saved.maxSeq=newestSeq;
          saved.initialized=true;
        }catch(cause){failures.push(`SDK launches unavailable (${cause instanceof Error?cause.message:"SDK error"})`);}
        sdkRows.push(...saved.sdk.values());
      }
      for(const thread of family){
        if(!enabled.current || !alive.current || stamp!==generation.current)return;
        let configuredModel:string|null=null,role:LaunchRow["role"]=null;
        try {
          const details=await sdkRef.current.threads.defaultExecutionOptions({threadId:thread.id});
          configuredModel=details?.model ?? null;
          const facts=await sdkRef.current.plugins.callRpc({pluginId:"model-routing",method:"getThreadRouting",input:{threadId:thread.id},outputSchema:z.object({role:z.enum(["coordinator","workers","reviewers"]).nullable(),configuredModel:z.string().nullable()})});
          role=facts.role;configuredModel=facts.configuredModel ?? configuredModel;
        }catch{/* Explicit unknown role/model; journal/SDK rows remain available. */}
        bb.push({id:thread.id,threadId:thread.id,parentId:thread.parentThreadId===threadId?null:thread.parentThreadId,
          kind:"bb-thread",role,providerId:thread.providerId,configuredModel,observedModel:null,
          status:thread.status==="error"?"failed":["pending","active","starting","stopping"].includes(thread.status)?"running":"done",
          startedAt:0,finishedAt:null,source:"bb",log:{threadId:thread.id,providerId:thread.providerId,status:thread.status}});
      }
      if(stamp===generation.current){setRows(mergeLaunches(journal,sdkRows,bb));setError(failures.length?[...new Set(failures)].join("; "):null);}

    } catch(cause){if(stamp===generation.current)setError(cause instanceof Error ? cause.message : "Launch history unavailable");}
    finally {loading.current=false;if(dirty.current){dirty.current=false;if(alive.current && enabled.current)void loadRef.current();}}
  },[open,threadId,threads]);
  const loadRef=useRef(load);loadRef.current=load;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;dirty.current=false;};},[]);
  useEffect(()=>{generation.current++;cache.current.clear();setRows([]);setSelected(null);setError(null);return()=>{generation.current++;};},[threadId]);
  useEffect(()=>{
    if(!open)return;
    const change=()=>setForeground(!document.hidden);change();document.addEventListener("visibilitychange",change);
    if(typeof IntersectionObserver!=="undefined"){
      const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
      if(host.current)observer.observe(host.current);
      return()=>{observer.disconnect();document.removeEventListener("visibilitychange",change);};
    }
    return()=>document.removeEventListener("visibilitychange",change);
  },[open]);
  useEffect(()=>{
    if(!open || !foreground || !visible)return;
    void loadRef.current();
    // Schedule after the preceding load; slow requests never create a back-to-back poll backlog.
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{if(stopped)return;if(!loading.current)await loadRef.current();if(!stopped)timer=setTimeout(tick,5000);};
    timer=setTimeout(tick,5000);return()=>{stopped=true;clearTimeout(timer);};
  },[open,foreground,visible,threadId]);
  useEffect(()=>{
    if(!open || typeof sdk.subscribe!=="function")return;
    const ids=new Set([threadId]);
    for(let grew=true;grew;){grew=false;for(const thread of threads){if(thread.parentThreadId && ids.has(thread.parentThreadId) && !ids.has(thread.id)){ids.add(thread.id);grew=true;}}}
    const dispose=sdk.subscribe({event:"thread:changed",callback:event=>{
      if(!event.id || !ids.has(event.id))return;
      const kinds=event.metadata?.eventTypes;
      if(!kinds?.length || kinds.some(kind=>/delegation|backgroundTask|item\/completed|thread\/identity|turn\/completed|system\/thread\/interrupted|provider\/error/.test(kind)))void loadRef.current();
    }});
    return dispose;
  },[open,sdk,threadId,threads]);
  const currentLog=selected ? rows.find(row=>row.id===selected.id) ?? selected : null;
  return <div ref={host} className="px-3 pb-1 text-2xs" onClick={event=>event.stopPropagation()}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="text-muted-foreground hover:text-foreground">{open?"▾":"▸"} Launches</button>
    {open?<div role="region" aria-label="Launch tree">
      {error?<p role="alert">{error} <button type="button" onClick={()=>void load()}>Retry</button></p>:null}
      {!rows.length && !error?<p className="text-muted-foreground">No recorded launches</p>:null}
      {launchForest(rows).map(({row,depth})=><button type="button" key={row.id} style={{paddingLeft:Math.min(depth,8)*12}} className="block w-full truncate py-1 text-left" onClick={()=>{if(row.kind==="bb-thread")navigate.toThread(row.id);else setSelected(row);}} title={`${row.kind} · ${row.role??"role unknown"} · configured ${row.configuredModel??"unknown"} → observed ${row.observedModel??"unknown"} · ${row.status} ${row.confirmation??""}`}>
        {row.kind} · {row.role??"role unknown"} · cfg {row.configuredModel??"unknown"} · obs {row.observedModel??"unknown"} · {row.status} {row.confirmation??""}
      </button>)}

      {currentLog?<div role="region" aria-label="Launch log" className="rounded border border-border p-2">
        <button type="button" onClick={()=>setSelected(null)}>Close log</button>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(currentLog.log,null,2)}</pre>
        <button type="button" className="underline" onClick={()=>navigate.toThread(currentLog.threadId)}>Open thread transcript</button>
      </div>:null}
    </div>:null}
  </div>;
}
