// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),timeline:vi.fn(),navigate:vi.fn(),signals:new Map<string,(value:unknown)=>void>(),threads:[] as any[]}));
vi.mock("@get-bb/plugin-sdk/app",()=>({useSdk:()=>({subscribe:({event,callback}:any)=>{mocks.signals.set(event,callback);return()=>mocks.signals.delete(event);},plugins:{callRpc:mocks.rpc},threads:{timeline:mocks.timeline,defaultExecutionOptions:async()=>({model:"gpt-6.1-sol"})}}),useBbNavigate:()=>({toThread:mocks.navigate}),experimental_useSidebarThreads:()=>({threads:mocks.threads})}));
import {LaunchTree} from "./LaunchTree";
const agent={id:"a",threadId:"thr_root",parentId:null,kind:"claude-agent",role:"workers",providerId:"claude-code",configuredModel:"claude-opus-5-5",observedModel:null,status:"running",startedAt:1,finishedAt:null};
const job={...agent,id:"b",parentId:"a",kind:"codex-bridge",providerId:"codex",configuredModel:"gpt-6.1-sol",startedAt:2};
let launches:any[];
beforeEach(()=>{launches=[agent,job];mocks.threads=[];mocks.signals.clear();mocks.navigate.mockReset();mocks.rpc.mockReset().mockImplementation(async({method})=>method==="listLaunches"?launches:method==="listLaunchChanges"?{revision:1,rows:launches,hasMore:false}:{role:null,configuredModel:null});mocks.timeline.mockReset().mockResolvedValue({rows:[],activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
async function open(){await act(async()=>render(<LaunchTree threadId="thr_root"/>));await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Launches/})));}
describe("launch tree UI",()=>{
 it("fetches only on expansion, renders both models and refreshes running to done on SDK delegation event",async()=>{
  await act(async()=>render(<LaunchTree threadId="thr_root"/>));expect(mocks.rpc).not.toHaveBeenCalled();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Launches/})));
  expect(screen.getByRole("button",{name:/codex-bridge.*gpt-6.1-sol.*unknown.*running/})).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/codex-bridge.*running/})));
  expect(screen.getByRole("region",{name:"Launch log"}).textContent).toContain('"status": "running"');
  launches=[agent,{...job,observedModel:"gpt-6.1-sol",status:"done",finishedAt:3}];
  await act(async()=>mocks.signals.get("thread:changed")!({id:"thr_root",metadata:{eventTypes:["item/delegation/completed"]}}));
  expect(screen.getByRole("button",{name:/codex-bridge.*gpt-6.1-sol.*gpt-6.1-sol.*done/})).toBeTruthy();
  expect(screen.getByRole("region",{name:"Launch log"}).textContent).toContain('"status": "done"');
  expect(screen.getByRole("region",{name:"Launch log"}).textContent).toContain('"observedModel": "gpt-6.1-sol"');
 });
 it("retains SDK history when the journal plugin is unavailable and names the gap",async()=>{
  mocks.rpc.mockRejectedValue(new Error("plugin offline"));mocks.timeline.mockResolvedValue({rows:[{workKind:"delegation",callId:"native-x",status:"pending"}],activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}});
  await open();expect(screen.getByRole("alert").textContent).toContain("journal unavailable");expect(screen.getByRole("button",{name:/native delegation.*running/})).toBeTruthy();
 });
 it("shows nested BB descendants and configured identity without inventing observation",async()=>{
  mocks.threads=[{id:"thr_child",parentThreadId:"thr_root",providerId:"codex",status:"active"},{id:"thr_grandchild",parentThreadId:"thr_child",providerId:"claude-code",status:"idle"}];
  mocks.rpc.mockImplementation(async({method,input})=>method==="listLaunches"?[]:method==="listLaunchChanges"?{revision:1,rows:[],hasMore:false}:{role:"workers",configuredModel:input.threadId==="thr_child"?"gpt-6.1-sol":"claude-opus-5-5"});
  await open();expect(screen.getByRole("button",{name:/bb-thread.*claude-opus-5-5.*unknown.*done/})).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/bb-thread.*gpt-6.1-sol.*running/})));
  expect(mocks.navigate).toHaveBeenCalledWith("thr_child");
 });
 it("reads older SDK pages and deduplicates overlap",async()=>{
  mocks.rpc.mockImplementation(async({method})=>method==="listLaunchChanges"?{revision:0,rows:[],hasMore:false}:[]);
  mocks.timeline.mockImplementation(async(args)=>args.beforeAnchorId?{rows:[{workKind:"delegation",callId:"older",status:"completed"}],activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}}:{rows:[{workKind:"delegation",callId:"latest",status:"pending"}],activeBackgroundCommands:[],timelinePage:{hasOlderRows:true,olderCursor:{anchorId:"cursor1",anchorSeq:10}}});
  await open();expect(screen.getAllByRole("button",{name:/native delegation/})).toHaveLength(2);
  expect(mocks.timeline).toHaveBeenCalledWith(expect.objectContaining({beforeAnchorId:"cursor1",beforeAnchorSeq:"10"}));
 });

 it("pending BB child remains queued, never done",async()=>{
  mocks.threads=[{id:"thr_child",parentThreadId:"thr_root",providerId:"codex",status:"pending"}];
  await open();expect(screen.getByRole("button",{name:/bb-thread.*running/})).toBeTruthy();
 });
 it("polls newest changes only and pauses on hidden, collapse and unmount",async()=>{
  vi.useFakeTimers();let hidden=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  const view=render(<LaunchTree threadId="thr_root"/>);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Launches/})));
  const initial=mocks.timeline.mock.calls.length;
  await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(mocks.timeline.mock.calls.length).toBe(initial+1);
  expect(mocks.rpc.mock.calls.filter(([args])=>args.method==="listLaunches")).toHaveLength(1);
  hidden=true;await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  const count=mocks.timeline.mock.calls.length;await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(mocks.timeline.mock.calls.length).toBe(count);
  hidden=false;await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Launches/})));
  const closed=mocks.timeline.mock.calls.length;await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(mocks.timeline.mock.calls.length).toBe(closed);
  view.unmount();expect(mocks.signals.size).toBe(0);expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();vi.restoreAllMocks();
 });

 it("uses the SDK sequence cursor on refresh without reloading old pages",async()=>{
  mocks.timeline.mockResolvedValue({rows:[],maxSeq:42,activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}});
  await open();await act(async()=>mocks.signals.get("thread:changed")!({id:"thr_root",metadata:{eventTypes:["system/thread/interrupted"]}}));
  expect(mocks.timeline).toHaveBeenLastCalledWith(expect.objectContaining({afterSequence:"42"}));
 });

});
