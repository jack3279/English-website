const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../routes/auth.js");
const me = require("../routes/me.js");
const { setMockResults, resetMock } = require("./setup.js");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const USER = { id:"00000000-0000-0000-0000-000000000001",role:"parent" };
const BODY = {current_password:"old-password",new_password:"NewPassword123!"};
async function call(handler,url,body,user=null) {
  const {req,res,captured}=applyMiddleware({url,method:"POST",body,testUser:user});
  await mustHandler(handler,req,res);return captured;
}
test.afterEach(()=>{resetMock();test.mock.restoreAll();delete globalThis.__CLOUDFLARE_ENV;});
test("匿名密码恢复不生成也不泄露任何恢复链接",async()=>{
  const fetch=test.mock.method(globalThis,"fetch",async()=>{throw new Error("unexpected transport");});
  const response=await call(auth,"/reset-password",{email:"owner@example.com"});
  assert.equal(response.statusCode,409);
  assert.equal(response.body.code,"SELF_RESET_UNAVAILABLE");
  assert.equal(JSON.stringify(response.body).includes("action_link"),false);
  assert.equal(fetch.mock.callCount(),0);
});
test("未登录不能修改密码",async()=>{
  assert.equal((await call(me,"/password",BODY)).statusCode,401);
});
test("禁止传入目标用户，弱密码和当前密码相同都不写入",async()=>{
  const fetch=test.mock.method(globalThis,"fetch",async()=>{throw new Error("unexpected write");});
  assert.equal((await call(me,"/password",{...BODY,userId:"someone"},USER)).statusCode,400);
  assert.equal((await call(me,"/password",{...BODY,new_password:"123"},USER)).statusCode,400);
  assert.equal((await call(me,"/password",{current_password:BODY.new_password,new_password:BODY.new_password},USER)).statusCode,400);
  assert.equal(fetch.mock.callCount(),0);
});
test("当前密码错误不修改账号",async()=>{
  setMockResults([{data:{user:{id:USER.id,email:"self@example.com"}},error:null},{data:null,error:{message:"wrong"}}]);
  const fetch=test.mock.method(globalThis,"fetch",async()=>{throw new Error("unexpected write");});
  const response=await call(me,"/password",BODY,USER);
  assert.equal(response.body.code,"CURRENT_PASSWORD_INVALID");assert.equal(fetch.mock.callCount(),0);
});
test("验证身份不匹配时拒绝写入",async()=>{
  setMockResults([{data:{user:{id:USER.id,email:"self@example.com"}},error:null},{data:{user:{id:"other"}},error:null}]);
  const response=await call(me,"/password",BODY,USER);
  assert.equal(response.statusCode,400);
});
test("修改只写当前账号，密码不回显，验证会话被清理",async()=>{
  globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"service"};
  setMockResults([{data:{user:{id:USER.id,email:"self@example.com"}},error:null},
    {data:{user:{id:USER.id}},error:null},{data:null,error:null},{data:null,error:null}]);
  const fetch=test.mock.method(globalThis,"fetch",async(url,options)=>{
    assert.equal(url,`https://db.test/auth/v1/admin/users/${USER.id}`);
    assert.equal(options.method,"PUT");
    assert.deepEqual(JSON.parse(options.body),{password:BODY.new_password});
    return new Response(JSON.stringify({id:USER.id}),{status:200});
  });
  const response=await call(me,"/password",BODY,USER);
  assert.equal(response.statusCode,200);assert.equal(response.body.data.changed,true);
  assert.equal(JSON.stringify(response.body).includes(BODY.new_password),false);
  assert.equal(fetch.mock.callCount(),1);
});
test("身份服务写入失败不能提示成功",async()=>{
  globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"service"};
  setMockResults([{data:{user:{id:USER.id,email:"self@example.com"}},error:null},{data:{user:{id:USER.id}},error:null}]);
  test.mock.method(globalThis,"fetch",async()=>new Response("failure",{status:500}));
  assert.equal((await call(me,"/password",BODY,USER)).statusCode,503);
});
