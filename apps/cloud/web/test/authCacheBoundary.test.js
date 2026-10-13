import { test,expect,vi,afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { installAuthCacheBoundary } from "../src/lib/authCacheBoundary.js";
const state=vi.hoisted(()=>({user:null}));
vi.mock("../src/lib/auth-store.js",()=>({getUser:()=>state.user}));
let dispose,client;
afterEach(()=>{dispose?.();client?.clear();state.user=null;});
function setup(){state.user={id:"admin",role:"admin"};client=new QueryClient();client.setQueryData(["students"],[{id:"private-child"}]);dispose=installAuthCacheBoundary(client);}
test("退出登录时清空学员缓存",()=>{setup();state.user=null;window.dispatchEvent(new CustomEvent("auth:changed"));expect(client.getQueryData(["students"])).toBeUndefined();});
test("切换账号或角色后不复用上个权限的缓存",()=>{setup();state.user={id:"parent",role:"parent"};window.dispatchEvent(new CustomEvent("auth:changed"));expect(client.getQueryData(["students"])).toBeUndefined();client.setQueryData(["students"],[{id:"own-child"}]);state.user={id:"parent",role:"teacher"};window.dispatchEvent(new CustomEvent("auth:changed"));expect(client.getQueryData(["students"])).toBeUndefined();});
test("同一账号续签不会清空业务缓存",()=>{setup();window.dispatchEvent(new CustomEvent("auth:changed"));expect(client.getQueryData(["students"])).toEqual([{id:"private-child"}]);});
