import { useCallback,useEffect,useRef,useState } from "react";
import { useSdk,useBbNavigate,experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { launchSchema,launchForest,mergeLaunches,sdkLaunches,type JournalLaunch,type LaunchRow } from "./launch-tree";

export function LaunchTree({threadId}:{threadId:string}) {
  const sdk=useSdk(),navigate=useBbNavigate(),{threads}=useSidebarThreads();
  const [open,setOpen]=useState(false),[rows,setRows]=useState<LaunchRow[]>([]),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<LaunchRow|null>(null);
  const generation=useRef(0),loading=useRef(false),dirty=useRef(false);
  const sdkRef=useRef(sdk);sdkRef.current=sdk;
  const load=useCallback(async()=>{
    if(!open)return;
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
        const parent=current===threadId?null:current;
        try {
          for(let offset=0;;offset+=1000){
            const batch=await sdkRef.current.plugins.callRpc({pluginId:"model-routing",method:"listLaunches",input:{threadId:current,offset,limit:1000},outputSchema:z.array(launchSchema)});
            journal.push(...batch.map(row=>({...row,parentId:row.parentId ?? parent})));if(batch.length<1000)break;
          }
        }catch(cause){failures.push(`${current}: journal unavailable (${cause instanceof Error?cause.message:"RPC error"})`);}
        try {
          let timeline=await sdkRef.current.threads.timeline({threadId:current,includeNestedRows:"true",segmentLimit:"100"});
          sdkRows.push(...sdkLaunches([...timeline.rows,...timeline.activeBackgroundCommands],current,parent));
          const cursors=new Set<string>();
          while(timeline.timelinePage.hasOlderRows){
            const cursor=timeline.timelinePage.olderCursor;
            if(!cursor || cursors.has(cursor.anchorId)){failures.push(`${current}: SDK history cursor unavailable`);break;}
            cursors.add(cursor.anchorId);
            timeline=await sdkRef.current.threads.timeline({threadId:current,includeNestedRows:"true",segmentLimit:"100",beforeAnchorId:cursor.anchorId,beforeAnchorSeq:String(cursor.anchorSeq)});
            sdkRows.push(...sdkLaunches(timeline.rows,current,parent));
          }
        }catch(cause){failures.push(`${current}: SDK launches unavailable (${cause instanceof Error?cause.message:"SDK error"})`);}
      }
      for(const thread of family){
        let configuredModel:string|null=null,role:LaunchRow["role"]=null;
        try {
          const details=await sdkRef.current.threads.defaultExecutionOptions({threadId:thread.id});
          configuredModel=details?.model ?? null;
          const facts=await sdkRef.current.plugins.callRpc({pluginId:"model-routing",method:"getThreadRouting",input:{threadId:thread.id},outputSchema:z.object({role:z.enum(["coordinator","workers","reviewers"]).nullable(),configuredModel:z.string().nullable()})});
          role=facts.role;configuredModel=facts.configuredModel ?? configuredModel;
        }catch{/* Explicit unknown role/model; journal/SDK rows remain available. */}
        bb.push({id:thread.id,threadId:thread.id,parentId:thread.parentThreadId===threadId?null:thread.parentThreadId,
          kind:"bb-thread",role,providerId:thread.providerId,configuredModel,observedModel:null,
          status:thread.status==="error"?"failed":["active","starting","stopping"].includes(thread.status)?"running":"done",
          startedAt:0,finishedAt:null,source:"bb",log:{threadId:thread.id,providerId:thread.providerId,status:thread.status}});
      }
      if(stamp===generation.current){setRows(mergeLaunches(journal,sdkRows,bb));setError(failures.length?failures.join("; "):null);}

    } catch(cause){if(stamp===generation.current)setError(cause instanceof Error ? cause.message : "Launch history unavailable");}
    finally {loading.current=false;if(dirty.current){dirty.current=false;void loadRef.current();}}
  },[open,threadId,threads]);
  const loadRef=useRef(load);loadRef.current=load;
  useEffect(()=>{generation.current++;setRows([]);setSelected(null);setError(null);void load();return()=>{generation.current++;};},[threadId,open]);
  useEffect(()=>{if(!open)return;void load();const timer=setInterval(()=>void loadRef.current(),5000);return()=>clearInterval(timer);},[open,load]);
  useEffect(()=>{
    if(!open || typeof sdk.subscribe!=="function")return;
    const ids=new Set([threadId]);
    for(let grew=true;grew;){grew=false;for(const thread of threads){if(thread.parentThreadId && ids.has(thread.parentThreadId) && !ids.has(thread.id)){ids.add(thread.id);grew=true;}}}
    const dispose=sdk.subscribe({event:"thread:changed",callback:event=>{
      if(!event.id || !ids.has(event.id))return;
      const kinds=event.metadata?.eventTypes;
      if(!kinds?.length || kinds.some(kind=>/delegation|backgroundTask|item\/completed|thread\/identity|turn\/completed/.test(kind)))void loadRef.current();
    }});
    return dispose;
  },[open,sdk,threadId,threads]);
  const currentLog=selected ? rows.find(row=>row.id===selected.id) ?? selected : null;
  return <div className="px-3 pb-1 text-2xs" onClick={event=>event.stopPropagation()}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="text-muted-foreground hover:text-foreground">{open?"▾":"▸"} Launches</button>
    {open?<div role="region" aria-label="Launch tree">
      {error?<p role="alert">{error} <button type="button" onClick={()=>void load()}>Retry</button></p>:null}
      {!rows.length && !error?<p className="text-muted-foreground">No recorded launches</p>:null}
      {launchForest(rows).map(({row,depth})=><button type="button" key={row.id} style={{paddingLeft:Math.min(depth,8)*12}} className="block w-full truncate py-1 text-left" onClick={()=>{if(row.kind==="bb-thread")navigate.toThread(row.id);else setSelected(row);}} title={`${row.kind} · ${row.role??"role unknown"} · configured ${row.configuredModel??"unknown"} → observed ${row.observedModel??"unknown"} · ${row.status}`}>
        {row.kind} · {row.role??"role unknown"} · {row.configuredModel??"unknown"} → {row.observedModel??"unknown"} · {row.status}
      </button>)}

      {currentLog?<div role="region" aria-label="Launch log" className="rounded border border-border p-2">
        <button type="button" onClick={()=>setSelected(null)}>Close log</button>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(currentLog.log,null,2)}</pre>
        <button type="button" className="underline" onClick={()=>navigate.toThread(currentLog.threadId)}>Open thread transcript</button>
      </div>:null}
    </div>:null}
  </div>;
}
