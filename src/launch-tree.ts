import { z } from "zod";

export const launchSchema = z.object({
  id:z.string(), threadId:z.string(), parentId:z.string().nullable(), callId:z.string().optional(),
  kind:z.enum(["bb-thread","claude-agent","codex-agent","codex-bridge","background-task"]),
  role:z.enum(["coordinator","workers","reviewers"]), providerId:z.string().nullable(),
  configuredModel:z.string().nullable(), observedModel:z.string().nullable(),
  status:z.enum(["running","done","failed"]), startedAt:z.number(), finishedAt:z.number().nullable(),
});
export type JournalLaunch = z.infer<typeof launchSchema>;
export type LaunchRow = Omit<JournalLaunch,"role"|"kind"> & {
  role:JournalLaunch["role"]|null; confirmation?:string; kind:string; source:"journal"|"sdk"|"bb"; log:Record<string,unknown>;
};
const record = (value:unknown):Record<string,unknown> => value && typeof value==="object" ? value as Record<string,unknown> : {};
const text = (value:unknown) => typeof value==="string" ? value : null;
export function sdkLaunches(rows:readonly unknown[], threadId:string, parentId:string|null=null):LaunchRow[] {
  return rows.flatMap(value=>{
    const row=record(value);
    const delegation=row.workKind==="delegation";
    const background=row.workKind==="workflow" && !row.workflow;
    if (!delegation && !background) return [];
    const id=text(row.callId) ?? text(row.itemId) ?? text(row.id);
    if (!id) return [];
    // SDK descriptions/output may contain prompts or transcript text. Copy metadata only.
    const log={id,callId:text(row.callId),childRef:text(row.childRef),subagentType:text(row.subagentType),
      status:row.status,taskStatus:row.taskStatus,sourceSeqStart:row.sourceSeqStart,sourceSeqEnd:row.sourceSeqEnd};
    const status=row.status==="error" || row.status==="interrupted" || row.taskStatus==="failed" || row.taskStatus==="killed" || row.taskStatus==="stopped"
      ? "failed" : row.taskStatus==="completed" || (!row.taskStatus && row.status==="completed") ? "done" : "running";
    const item:LaunchRow={id:`sdk:${threadId}:${id}`,callId:id,threadId,parentId,kind:delegation ? "native delegation" : "background-task",
      role:null,providerId:null,configuredModel:null,observedModel:null,status,
      startedAt:typeof row.startedAt==="number" ? row.startedAt : 0,
      confirmation:row.taskStatus==="paused"?"paused":undefined,finishedAt:typeof row.completedAt==="number" ? row.completedAt : null,source:"sdk",log};
    return [item,...sdkLaunches(Array.isArray(row.childRows)?row.childRows:[],threadId,item.id)];
  });
}
export function mergeLaunches(journal:JournalLaunch[], sdk:LaunchRow[], bb:LaunchRow[],now=Date.now()):LaunchRow[] {
  const calls=new Map(journal.filter(row=>row.callId).map(row=>[`sdk:${row.threadId}:${row.callId}`,row.id]));
  const childIds=new Set(journal.filter(row=>row.kind==="bb-thread").map(row=>row.id));
  const sdkById=new Map(sdk.map(row=>[row.id,row]));
  const result:LaunchRow[]=[...journal.map(row=>{
    const counterpart=row.callId?sdkById.get(`sdk:${row.threadId}:${row.callId}`):undefined;
    const terminal=row.status==="failed"?row:counterpart?.status==="failed"?counterpart:row.status==="done"?row:counterpart?.status==="done"?counterpart:undefined;
    const status=terminal?.status??row.status,finishedAt=terminal?.finishedAt??row.finishedAt;
    const confirmation=counterpart?.confirmation??(row.status==="running" && !counterpart && now-row.startedAt>300000?"stale / unconfirmed":undefined);
    return {...row,status,finishedAt,confirmation,source:"journal" as const,log:{...row,status,finishedAt,confirmation,journalStatus:row.status,sdkStatus:counterpart?.status}};
  }),
    ...sdk.filter(row=>!calls.has(row.id)).map(row=>({...row,parentId:row.parentId?.startsWith("sdk:") ? calls.get(row.parentId) ?? row.parentId : row.parentId})),
    ...bb.filter(row=>!childIds.has(row.id))];
  const unique = new Map(result.map(row=>[row.id,row]));
  return [...unique.values()].sort((a,b)=>a.startedAt-b.startedAt || a.id.localeCompare(b.id));
}
export function launchForest(rows:readonly LaunchRow[]):Array<{row:LaunchRow;depth:number}> {
  const ids=new Set(rows.map(row=>row.id));
  const output:Array<{row:LaunchRow;depth:number}>=[],seen=new Set<string>();
  const visit=(row:LaunchRow,depth:number)=>{
    if(seen.has(row.id))return; seen.add(row.id); output.push({row,depth});
    rows.filter(child=>child.parentId===row.id).forEach(child=>visit(child,depth+1));
  };
  rows.filter(row=>!row.parentId || !ids.has(row.parentId)).forEach(row=>visit(row,0));
  rows.forEach(row=>visit(row,0)); // Corrupt cycles stay visible without recursion loops.
  return output;
}
