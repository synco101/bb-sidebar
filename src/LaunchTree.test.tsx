// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),timeline:vi.fn(),navigate:vi.fn(),signals:new Map<string,(value:unknown)=>void>(),threads:[] as any[]}));
vi.mock("@get-bb/plugin-sdk/app",()=>({useSdk:()=>({subscribe:({event,callback}:any)=>{mocks.signals.set(event,callback);return()=>mocks.signals.delete(event);},plugins:{callRpc:mocks.rpc},threads:{timeline:mocks.timeline,defaultExecutionOptions:async()=>({model:"gpt-6.1-sol"})}}),useBbNavigate:()=>({toThread:mocks.navigate}),experimental_useSidebarThreads:()=>({threads:mocks.threads}),useRealtime:(topic:string,handler:(value:unknown)=>void)=>mocks.signals.set(topic,handler)}));
import {LaunchTree} from "./LaunchTree";
const agent={id:"a",threadId:"thr_root",parentId:null,kind:"claude-agent",role:"workers",providerId:"claude-code",configuredModel:"claude-opus-5-5",observedModel:null,status:"running",startedAt:1,finishedAt:null};
const job={...agent,id:"b",parentId:"a",kind:"codex-bridge",providerId:"codex",configuredModel:"gpt-6.1-sol",startedAt:2};
let launches:any[];
beforeEach(()=>{launches=[agent,job];mocks.threads=[];mocks.signals.clear();mocks.navigate.mockReset();mocks.rpc.mockReset().mockImplementation(async({method})=>method==="listLaunches"?launches:{role:null,configuredModel:null});mocks.timeline.mockReset().mockResolvedValue({rows:[],activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}});});
afterEach(cleanup);
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
  mocks.rpc.mockImplementation(async({method,input})=>method==="listLaunches"?[]:{role:"workers",configuredModel:input.threadId==="thr_child"?"gpt-6.1-sol":"claude-opus-5-5"});
  await open();expect(screen.getByRole("button",{name:/bb-thread.*claude-opus-5-5.*unknown.*done/})).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/bb-thread.*gpt-6.1-sol.*running/})));
  expect(mocks.navigate).toHaveBeenCalledWith("thr_child");
 });
 it("reads older SDK pages and deduplicates overlap",async()=>{
  mocks.rpc.mockImplementation(async()=>[]);
  mocks.timeline.mockImplementation(async(args)=>args.beforeAnchorId?{rows:[{workKind:"delegation",callId:"older",status:"completed"}],activeBackgroundCommands:[],timelinePage:{hasOlderRows:false}}:{rows:[{workKind:"delegation",callId:"latest",status:"pending"}],activeBackgroundCommands:[],timelinePage:{hasOlderRows:true,olderCursor:{anchorId:"cursor1",anchorSeq:10}}});
  await open();expect(screen.getAllByRole("button",{name:/native delegation/})).toHaveLength(2);
  expect(mocks.timeline).toHaveBeenCalledWith(expect.objectContaining({beforeAnchorId:"cursor1",beforeAnchorSeq:"10"}));
 });

});
