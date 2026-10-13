const test=require("node:test");
const assert=require("node:assert/strict");
const students=require("../routes/students.js"),packages=require("../routes/packages.js");
const {applyMiddleware,mustHandler}=require("./helpers.js");
const {setMockResults,resetMock}=require("./setup.js");
const ID="11111111-1111-1111-1111-111111111111";
const TEACHER={id:"teacher",role:"teacher"},PARENT={id:"parent",role:"parent"};
async function call(handler,url,user,method="GET",body=null){const {req,res,captured}=applyMiddleware({url,method,body,testUser:user});await mustHandler(handler,req,res);return captured;}
test.afterEach(()=>{resetMock();test.mock.restoreAll();});
test("老师不能直接建改学员、调整课时或开课时包",async()=>{
  for(const [path,method,body]of [["/","POST",{full_name:"Someone"}],[`/${ID}`,"PATCH",{full_name:"Changed"}],[`/${ID}/adjust-hours`,"POST",{delta:10,reason:"test"}]]){
    assert.equal((await call(students,path,TEACHER,method,body)).statusCode,403);
  }
  assert.equal((await call(packages,"/purchase",TEACHER,"POST",{})).statusCode,403);
  assert.equal((await call(packages,"/student",TEACHER,"POST",{})).statusCode,403);
});
test("老师没有关联学员时列表为空，详情和报告不能读取他人",async()=>{
  setMockResults([{data:[],error:null},{data:[],error:null}]);
  assert.deepEqual((await call(students,"/",TEACHER)).body.data,[]);
  for(const suffix of ["","/report"]){
    setMockResults([{data:[],error:null},{data:[],error:null}]);
    assert.equal((await call(students,`/${ID}${suffix}`,TEACHER)).statusCode,404);
  }
});
test("老师可以看到课程关联学员的列表和课时余额",async()=>{
  setMockResults([{data:[{student_id:ID}],error:null},{data:[],error:null},
    {data:[{id:ID,full_name:"Assigned"}],count:1,error:null},{data:[{student_id:ID,remaining_hours:3}],error:null}]);
  const response=await call(students,"/",TEACHER);
  assert.equal(response.statusCode,200);assert.equal(response.body.data[0].remaining_hours,3);
});
test("家长不能用其他学员ID读取学习报告、课时包或缴费",async()=>{
  for(const [handler,path] of [[students,`/${ID}/report`],[packages,`/student/${ID}`],[packages,`/payments/${ID}`]]){
    setMockResults([{data:[{student_id:"other"}],error:null}]);
    assert.equal((await call(handler,path,PARENT)).statusCode,404);
  }
});
test("家长可以查看自己孩子的缴费记录，老师不能查看收款记录",async()=>{
  setMockResults([{data:[{student_id:ID}],error:null},{data:[{id:"payment",amount_cents:100}],error:null}]);
  assert.equal((await call(packages,`/payments/${ID}`,PARENT)).body.data[0].amount_cents,100);
  assert.equal((await call(packages,`/payments/${ID}`,TEACHER)).statusCode,403);
});
test("非管理员不能读取课时包类型的全机构销售统计",async()=>{
  assert.equal((await call(packages,`/types/${ID}`,PARENT)).statusCode,403);
  assert.equal((await call(packages,`/types/${ID}`,TEACHER)).statusCode,403);
});
