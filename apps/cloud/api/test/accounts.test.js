const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../routes/accounts.js");
const {applyMiddleware,mustHandler}=require("./helpers.js");
const {setMockResults,resetMock}=require("./setup.js");
const ADMIN={id:"00000000-0000-0000-0000-000000000001",role:"admin"};
const NEW_ID="00000000-0000-0000-0000-000000000002";
const INPUT={email:"owner@example.com",name:"Owner",password:"NewPassword123!",current_password:"old-password",confirmed:true};
async function call(url,method="GET",body=null,user=ADMIN){const {req,res,captured}=applyMiddleware({url,method,body,testUser:user});await mustHandler(handler,req,res);return captured;}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
test.beforeEach(()=>{globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"service"};});
test.afterEach(()=>{resetMock();test.mock.restoreAll();delete globalThis.__CLOUDFLARE_ENV;});
function proof(){setMockResults([{data:{user:{id:ADMIN.id,email:"current@example.com"}},error:null},{data:{user:{id:ADMIN.id}},error:null},{data:null,error:null}]);}
test("账号列表和管理员开户拒绝教师、家长、匿名请求",async()=>{
  assert.equal((await call("/", "GET",null,{...ADMIN,role:"teacher"})).statusCode,403);
  assert.equal((await call("/admin","POST",INPUT,{...ADMIN,role:"parent"})).statusCode,403);
  assert.equal((await call("/admin","POST",INPUT,null)).statusCode,401);
});
test("账号列表只返回必要字段，不回显凭据和用户元数据",async()=>{
  setMockResults([{data:[{id:ADMIN.id,full_name:"Admin",role:"admin"}],error:null}]);
  test.mock.method(globalThis,"fetch",async()=>json({users:[{id:ADMIN.id,email:"current@example.com",user_metadata:{secret:"private"},encrypted_password:"hash"}]}));
  const response=await call("/");assert.equal(response.body.data.items[0].email,"current@example.com");
  assert.equal(JSON.stringify(response.body).includes("private"),false);assert.equal(JSON.stringify(response.body).includes("hash"),false);
});
test("开户必须确认身份并验证当前密码，重复邮箱不被覆盖",async()=>{
  assert.equal((await call("/admin","POST",{...INPUT,confirmed:false})).statusCode,400);
  proof();const fetch=test.mock.method(globalThis,"fetch",async()=>json({users:[{id:NEW_ID,email:INPUT.email}]}));
  const response=await call("/admin","POST",INPUT);assert.equal(response.statusCode,409);assert.equal(fetch.mock.callCount(),1);
});
test("创建管理员使用数据库角色，返回值与审计均不包含密码",async()=>{
  proof();const calls=[];
  test.mock.method(globalThis,"fetch",async(url,init)=>{
    calls.push({url,init});
    if(init?.method==="POST"&&url.endsWith("/auth/v1/admin/users"))return json({id:NEW_ID},201);
    if(url.includes("/rest/v1/profiles"))return json([{id:NEW_ID}],201);
    return json({users:[]});
  });
  const response=await call("/admin","POST",INPUT);assert.equal(response.statusCode,200);
  const profile=JSON.parse(calls.find(item=>item.url.includes("/rest/v1/profiles")).init.body)[0];
  assert.equal(profile.role,"admin");assert.equal(profile.id,NEW_ID);
  assert.equal(JSON.stringify(response.body).includes(INPUT.password),false);
});
test("资料写入失败回滚刚创建账号，不触及已有账号",async()=>{
  proof();const deleted=[];
  test.mock.method(globalThis,"fetch",async(url,init)=>{
    if(init?.method==="POST"&&url.endsWith("/auth/v1/admin/users"))return json({id:NEW_ID},201);
    if(url.includes("/rest/v1/profiles"))return json({message:"fail"},500);
    if(init?.method==="DELETE"){deleted.push(url);return new Response(null,{status:204});}
    return json({users:[]});
  });
  const response=await call("/admin","POST",INPUT);assert.equal(response.statusCode,503);
  assert.deepEqual(deleted,[`https://db.test/auth/v1/admin/users/${NEW_ID}`]);
});
test("管理员重置密码须核对身份，不允许绕开自身密码修改流程",async()=>{
  assert.equal((await call("/password","POST",{id:NEW_ID,password:INPUT.password,current_password:INPUT.current_password,confirmed:false})).statusCode,400);
  assert.equal((await call("/password","POST",{id:ADMIN.id,password:INPUT.password,current_password:INPUT.current_password,confirmed:true})).statusCode,400);
});
test("管理员重置已有用户密码不改变角色和业务记录，也不回显密码",async()=>{
  setMockResults([{data:{user:{id:ADMIN.id,email:"current@example.com"}},error:null},
    {data:{user:{id:ADMIN.id}},error:null},{data:[{id:NEW_ID}],error:null},{data:null,error:null}]);
  const calls=[];
  test.mock.method(globalThis,"fetch",async(url,init)=>{calls.push({url,init});return json({id:NEW_ID});});
  const response=await call("/password","POST",{id:NEW_ID,password:INPUT.password,current_password:INPUT.current_password,confirmed:true});
  assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(calls[0].init.body),{password:INPUT.password});
  assert.equal(calls[0].url,`https://db.test/auth/v1/admin/users/${NEW_ID}`);
  assert.equal(JSON.stringify(response.body).includes(INPUT.password),false);
});
