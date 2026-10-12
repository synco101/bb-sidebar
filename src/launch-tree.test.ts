import { describe,it,expect } from "vitest";
import { launchForest,mergeLaunches,sdkLaunches,type JournalLaunch,type LaunchRow } from "./launch-tree";
const agent:JournalLaunch={id:"native-a",callId:"call-a",threadId:"thr_root",parentId:null,kind:"claude-agent",role:"workers",providerId:"claude-code",configuredModel:"claude-opus-5-5",observedModel:"claude-opus-5-5",status:"running",startedAt:1,finishedAt:null};
const bridge:JournalLaunch={...agent,id:"bridge-b",callId:undefined,parentId:agent.id,kind:"codex-bridge",providerId:"codex",configuredModel:"gpt-6.1-sol",observedModel:null,startedAt:2};
describe("launch tree",()=>{
 it("shows Claude to Codex nesting and transitions running to done with observed model",()=>{
  let tree=launchForest(mergeLaunches([agent,bridge],[],[]));expect(tree.map(item=>item.depth)).toEqual([0,1]);
  expect(tree[1].row.status).toBe("running");expect(tree[1].row.observedModel).toBeNull();
  tree=launchForest(mergeLaunches([agent,{...bridge,status:"done",observedModel:"gpt-6.1-sol",finishedAt:3}],[],[]));
  expect(tree[1].row.status).toBe("done");expect(tree[1].row.observedModel).toBe("gpt-6.1-sol");
 });
 it("merges matching SDK call once and reparents nested SDK rows to the journal agent",()=>{
  const sdk=sdkLaunches([{workKind:"delegation",callId:"call-a",status:"pending",childRows:[{workKind:"delegation",callId:"call-b",status:"completed"}]}],"thr_root");
  const rows=mergeLaunches([agent],sdk,[]);expect(rows).toHaveLength(2);expect(launchForest(rows).map(item=>item.depth)).toEqual([0,1]);
 });
 it("does not copy SDK output or prompts into log or assert inherited model as observed",()=>{
  const [row]=sdkLaunches([{workKind:"delegation",callId:"call-a",status:"pending",output:"PRIVATE_TRANSCRIPT",description:"PRIVATE_PROMPT",model:"parent-model"}],"thr_root");
  expect(JSON.stringify(row)).not.toMatch(/PRIVATE|parent-model/);expect(row.configuredModel).toBeNull();expect(row.observedModel).toBeNull();
 });
 it("projects completed and failed background jobs",()=>{
  const rows=sdkLaunches([{workKind:"workflow",workflow:null,itemId:"bg-a",taskStatus:"completed"},{workKind:"workflow",workflow:null,itemId:"bg-b",taskStatus:"failed"}],"thr_root");
  expect(rows.map(row=>row.status)).toEqual(["done","failed"]);
 });
 it("keeps missing parents and cycles visible without recursion loops",()=>{
  const rows=mergeLaunches([{...agent,parentId:"bridge-b"},bridge,{...agent,id:"orphan",parentId:"missing"}],[],[]);
  expect(launchForest(rows)).toHaveLength(3);
 });
 it("keeps BB child navigable beside native rows",()=>{
  const bb={...bridge,id:"thr_child",threadId:"thr_child",parentId:null,kind:"bb-thread",role:null,source:"bb",log:{threadId:"thr_child"}} as LaunchRow;
  expect(mergeLaunches([agent],[ ],[bb])).toHaveLength(2);
 });
 it("does not merge identical call IDs from different threads",()=>{
  const sdk=[...sdkLaunches([{workKind:"delegation",callId:"call-a",status:"pending"}],"thr_root"),...sdkLaunches([{workKind:"delegation",callId:"call-a",status:"pending"}],"thr_other")];
  const rows=mergeLaunches([agent],sdk,[]);expect(rows).toHaveLength(2);expect(rows.map(row=>row.threadId).sort()).toEqual(["thr_other","thr_root"]);
 });

 it("SDK terminal status overrides a lost journal finish while preserving model provenance",()=>{
  const sdk=sdkLaunches([{workKind:"delegation",callId:agent.callId,status:"interrupted",completedAt:5}],agent.threadId);
  const [row]=mergeLaunches([agent],sdk,[]);
  expect(row.status).toBe("failed");expect(row.finishedAt).toBe(5);expect(row.configuredModel).toBe(agent.configuredModel);
 });
 it("old running journal launch without a live counterpart is explicitly unconfirmed",()=>{
  const [row]=mergeLaunches([agent],[],[],600001);
  expect(row.confirmation).toBe("stale / unconfirmed");expect(row.status).toBe("running");
 });
 it("stopped and paused SDK tasks are explicit",()=>{
  const rows=sdkLaunches(["stopped","paused"].map(taskStatus=>({workKind:"workflow",workflow:null,itemId:taskStatus,taskStatus,status:"pending"})),"thr_root");
  expect(rows[0].status).toBe("failed");expect(rows[1].confirmation).toBe("paused");
 });

});
