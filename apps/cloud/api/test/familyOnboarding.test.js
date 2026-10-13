const test=require("node:test"),assert=require("node:assert/strict");
const accounts=require("../routes/accounts.js"),families=require("../routes/families.js");
const {setMockResults,resetMock}=require("./setup.js");
const {applyMiddleware,mustHandler}=require("./helpers.js");
const ADMIN={id:"00000000-0000-0000-0000-000000000001",role:"admin"};
const USER="00000000-0000-0000-0000-000000000002",PARENT="00000000-0000-0000-0000-000000000003",STUDENT="00000000-0000-0000-0000-000000000004";
const INPUT={name:"Parent",email:"parent@example.com",password:"NewPassword123!",current_password:"current",confirmed:true,role:"parent"};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function call(handler,url,method="GET",body=null,user=ADMIN){const {req,res,captured}=applyMiddleware({url,method,body,testUser:user});await mustHandler(handler,req,res);return captured;}
function proof(extra=[]){setMockResults([{data:{user:{id:ADMIN.id,email:"admin@example.com"}},error:null},{data:{user:{id:ADMIN.id}},error:null},...extra,{data:null,error:null}]);}
test.beforeEach(()=>{globalThis.__CLOUDFLARE_ENV={SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test"};});
test.afterEach(()=>{resetMock();test.mock.restoreAll();delete globalThis.__CLOUDFLARE_ENV;});
test("家长开户同时创建家长档案和所选孩子关联，密码不回显",async()=>{
  proof([{data:[{id:STUDENT}],error:null}]);const writes=[];
  test.mock.method(globalThis,"fetch",async(url,init)=>{
    if(init?.method==="POST")writes.push({url,body:JSON.parse(init.body)});
    if(url.endsWith("/auth/v1/admin/users")&&init?.method==="POST")return json({id:USER},201);
    if(url.includes("/rest/v1/profiles"))return json([{id:USER}],201);
    if(url.includes("/rest/v1/parents"))return json([{id:PARENT}],201);
    if(url.includes("/rest/v1/parent_student_links"))return json([{parent_id:PARENT,student_id:STUDENT}],201);
    return json({users:[]});
  });
  const response=await call(accounts,"/create","POST",{...INPUT,student_ids:[STUDENT,STUDENT],phone:"13800000000"});
  assert.equal(response.statusCode,200);assert.equal(response.body.data.role,"parent");assert.equal(response.body.data.linkedStudents,1);
  assert.equal(writes.find(write=>write.url.includes("/profiles")).body[0].phone,"13800000000");
  assert.equal(JSON.stringify(response.body).includes(INPUT.password),false);
});
test("教师开户同时建档，排课引用profileId而非教师档案ID",async()=>{
  proof();let teacher;
  test.mock.method(globalThis,"fetch",async(url,init)=>{
    if(url.endsWith("/auth/v1/admin/users")&&init?.method==="POST")return json({id:USER},201);
    if(url.includes("/rest/v1/profiles"))return json([{id:USER}],201);
    if(url.includes("/rest/v1/teachers")){teacher=JSON.parse(init.body)[0];return json([{id:PARENT}],201);}
    return json({users:[]});
  });
  const response=await call(accounts,"/create","POST",{...INPUT,role:"teacher",teacher_hourly_pay:200,teacher_pay_currency:"PHP"});
  assert.equal(response.statusCode,200);assert.equal(teacher.profile_id,USER);assert.equal(teacher.hourly_pay,200);assert.equal(response.body.data.teacherId,PARENT);
});
test("普通开户入口不能创建管理员或让教师绑定孩子",async()=>{
  assert.equal((await call(accounts,"/create","POST",{...INPUT,role:"admin"})).statusCode,400);
  assert.equal((await call(accounts,"/create","POST",{...INPUT,role:"teacher",student_ids:[STUDENT]})).statusCode,400);
});
test("不存在的孩子在创建账号之前被拒绝",async()=>{
  proof([{data:[],error:null}]);const fetch=test.mock.method(globalThis,"fetch",async()=>{throw new Error("unexpected write");});
  assert.equal((await call(accounts,"/create","POST",{...INPUT,student_ids:[STUDENT]})).statusCode,404);assert.equal(fetch.mock.callCount(),0);
});
test("家长档案创建失败只回滚新账号，不动已有学员",async()=>{
  proof();const deleted=[];
  test.mock.method(globalThis,"fetch",async(url,init)=>{
    if(url.endsWith("/auth/v1/admin/users")&&init?.method==="POST")return json({id:USER},201);
    if(url.includes("/rest/v1/profiles"))return json([{id:USER}],201);
    if(url.includes("/rest/v1/parents"))return json({},500);
    if(init?.method==="DELETE"){deleted.push(url);return new Response(null,{status:204});}
    return json({users:[]});
  });
  assert.equal((await call(accounts,"/create","POST",INPUT)).statusCode,503);assert.deepEqual(deleted,[`https://db.test/auth/v1/admin/users/${USER}`]);
});
test("只有管理员能查看或更改家长关系",async()=>{
  assert.equal((await call(families,"/parents","GET",null,{id:USER,role:"parent"})).statusCode,403);
  assert.equal((await call(families,`/students/${STUDENT}`,"POST",{parent_id:PARENT,confirmed:true},{id:USER,role:"teacher"})).statusCode,403);
});
test("绑定已有家长须核实监护关系，重复绑定不产生第二条记录",async()=>{
  setMockResults([{data:[{id:STUDENT}],error:null}]);assert.equal((await call(families,`/students/${STUDENT}`,"POST",{parent_id:PARENT,confirmed:false})).statusCode,400);
  setMockResults([{data:[{id:STUDENT}],error:null},{data:[{id:PARENT,profiles:{role:"parent"}}],error:null},{data:[{parent_id:PARENT}],error:null},{data:null,error:null}]);
  const fetch=test.mock.method(globalThis,"fetch",async()=>{throw new Error("unexpected insert");});
  assert.equal((await call(families,`/students/${STUDENT}`,"POST",{parent_id:PARENT,relation:"mother",confirmed:true})).body.data.linked,true);assert.equal(fetch.mock.callCount(),0);
});
test("解除关联只删除关联记录，保留家长和学员",async()=>{
  setMockResults([{data:[{id:STUDENT}],error:null},{data:null,error:null}]);let url;
  test.mock.method(globalThis,"fetch",async(value)=>{url=value;return json([{parent_id:PARENT}]);});
  assert.equal((await call(families,`/students/${STUDENT}/parents/${PARENT}`,"DELETE",{confirmed:true})).statusCode,200);
  assert.ok(url.includes("/rest/v1/parent_student_links?"));assert.ok(url.includes(`student_id=eq.${STUDENT}`));assert.ok(url.includes(`parent_id=eq.${PARENT}`));
});
