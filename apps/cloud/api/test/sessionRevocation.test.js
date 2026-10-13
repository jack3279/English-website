const test=require("node:test");
const assert=require("node:assert/strict");
const sessions=require("../lib/sessions.js");
const {setMockResults,resetMock}=require("./setup.js");
const USER="00000000-0000-0000-0000-000000000001";
const SID="11111111-1111-1111-1111-111111111111";
function jwt(extra={}){return `header.${Buffer.from(JSON.stringify({session_id:SID,...extra})).toString("base64url")}.signature`;}
test.afterEach(()=>{resetMock();test.mock.restoreAll();delete globalThis.__CLOUDFLARE_ENV;});
test("会话指纹在JWT续期后保持稳定，无有效会话ID不生成指纹",()=>{
  assert.equal(sessions.sessionFingerprint(jwt({exp:100})),sessions.sessionFingerprint(jwt({exp:200})));
  assert.equal(sessions.sessionFingerprint("invalid"),null);
  assert.equal(sessions.sessionFingerprint(jwt({session_id:"invalid"})),null);
});
test("撤销设备阻止本站请求，检查存储失败不能放行",async()=>{
  setMockResults([{data:[{id:"revoked"}],error:null}]);
  await assert.rejects(sessions.assertSessionActive(USER,jwt()),error=>error.code==="SESSION_REVOKED");
  setMockResults([{data:null,error:{message:"db down"}}]);
  await assert.rejects(sessions.assertSessionActive(USER,jwt()),error=>error.status===503);
});
test("未撤销会话可继续使用，已撤销旧刷新令牌不能续签",async()=>{
  setMockResults([{data:[],error:null}]);await sessions.assertSessionActive(USER,jwt());
  setMockResults([{data:[{id:"revoked"}],error:null}]);
  await assert.rejects(sessions.assertRefreshActive("old-refresh"),error=>error.code==="SESSION_REVOKED");
});
test("设备列表可靠标识当前会话，不泄露会话指纹或刷新令牌",async()=>{
  setMockResults([{data:[{id:"current",refresh_token_hash:sessions.sessionFingerprint(jwt()),device_label:"Chrome"},
    {id:"legacy",refresh_token_hash:sessions.hashRefreshToken("secret-refresh")}],error:null}]);
  const rows=await sessions.listMySessions(USER,jwt());
  assert.equal(rows[0].is_current,true);assert.equal(rows[0].legacy,false);assert.equal(rows[1].legacy,true);
  assert.equal(rows[0].refresh_token_hash,undefined);assert.equal(JSON.stringify(rows).includes("secret-refresh"),false);
});
test("续签更新同一会话记录，撤销后不会被重新激活",async()=>{
  globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test"};
  setMockResults([{data:[{id:"existing",revoked_at:null}],error:null}]);
  const fetch=test.mock.method(globalThis,"fetch",async(url,options)=>{
    assert.equal(options.method,"PATCH");assert.ok(url.includes("revoked_at=is.null"));return new Response("[]");
  });
  await sessions.recordSession({userId:USER,refreshToken:"new-refresh",accessToken:jwt(),req:{headers:{}}});
  assert.equal(fetch.mock.callCount(),1);
  setMockResults([{data:[{id:"existing",revoked_at:new Date().toISOString()}],error:null}]);
  await sessions.recordSession({userId:USER,refreshToken:"new-refresh",accessToken:jwt(),req:{headers:{}}});
  assert.equal(fetch.mock.callCount(),1);
});
test("撤销按用户和稳定指纹限定，处理同一会话并发产生的记录",async()=>{
  globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test"};
  setMockResults([{data:[{refresh_token_hash:sessions.sessionFingerprint(jwt())}],error:null}]);
  test.mock.method(globalThis,"fetch",async(url)=>{
    assert.ok(url.includes(`user_id=eq.${USER}`));assert.ok(url.includes("refresh_token_hash=eq.session%3A"));
    return new Response(JSON.stringify([{id:"one"},{id:"two"}]));
  });
  assert.equal(await sessions.revokeSession(USER,"record"),2);
});
test("iPhone和微信内置浏览器识别正确",()=>{
  assert.equal(sessions.parseDeviceLabel("iPhone Mac OS X Safari/604 MicroMessenger/8"),"微信内置 on iOS");
});
