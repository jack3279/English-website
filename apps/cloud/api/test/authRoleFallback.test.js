// 守卫: requireAuth 在 profiles 行缺失时, 角色**只能**降级成 parent。
//
// 背景（提权后门）: lib/auth.js 曾经在 profiles 查不到时回退去读
// `data.user.user_metadata.role`。但 user_metadata 是**用户本人可写**的
// （Supabase 允许 updateUser({data:{...}}) 改自己的 metadata，拿到自己 token 就行）。
// 于是任何 profiles 行缺失的账号，只要把 metadata.role 改成 "admin" 就能拿到管理员权限。
//
// 现网两条建号路径（adminSeed.ensureProfile / importRows 建老师）都是
// 「建 auth 用户 + 同时写 profiles」，所以 profile 缺失只可能是数据异常 ——
// 这种情况下按最小权限降级即可，绝不能采信用户可控字段。
//
// ⚠️ test/setup.js 会通过 -r 预加载并把 lib/auth.js 换成 mock（requireAuth 直接读
// req.__testUser），所以这里必须先清 require cache 才能测到真实实现。
// 同理 lib/supabase.js 也要真实实现，才能自己控制 mock client 的返回值。
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const supabasePath = path.resolve(__dirname, "..", "lib", "supabase.js");
const authPath = path.resolve(__dirname, "..", "lib", "auth.js");
delete require.cache[supabasePath];
delete require.cache[authPath];

const { mockClient } = require("./mockSupabase.js");
const { setMockResults, resetMock } = require("./mockSupabase.js");

// 让 lib/supabase.js 的 getAdmin() 返回可控的 mockClient，
// 同时保留 createAuthClient / getUserClient（auth.js 会用到）。
let authUserResult = { data: { user: null }, error: null };
let profileResult = { data: null, error: null };
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getAdmin: () => ({
      auth: {
        // getUser 是 requireAuth 的第一个查询：返回当前登录用户
        getUser: async () => authUserResult,
      },
      from: () => ({
        // profiles 是 requireAuth 的第二个查询
        select: () => ({
          eq: () => ({
            maybeSingle: async () => profileResult,
          }),
        }),
      }),
    }),
    getUserClient: () => mockClient,
    createAuthClient: () => mockClient,
  },
};

const { requireAuth } = require("../lib/auth.js");

function fakeRes() {
  const res = {
    _captured: null,
    status(code) {
      res._captured = { statusCode: code };
      return res;
    },
    json(body) {
      res._captured = { ...(res._captured || {}), body };
      return res;
    },
  };
  return res;
}

function fakeReq(jwt = "test-jwt") {
  return { headers: { authorization: `Bearer ${jwt}` } };
}

test.beforeEach(() => {
  resetMock();
});

test.after(() => {
  // 还原成 setup.js 的 mock，别污染同进程内后续 require（每个 test file 独立进程，
  // 但 --test 会把多个文件跑在同一进程树里，稳妥起见复原）
  delete require.cache[supabasePath];
  delete require.cache[authPath];
});

test("profiles 缺失时, 即便user_metadata.role=admin 也只能降级为 parent", async () => {
  authUserResult = {
    data: {
      user: {
        id: "u-evil",
        email: "evil@example.com",
        //攻击者自己写进去的 metadata
        user_metadata: { role: "admin", full_name: "伪装管理员" },
      },
    },
    error: null,
  };
  profileResult = { data: null, error: null }; // profiles 行不存在

  const req = fakeReq();
  const ctx = await requireAuth(req, fakeRes());

  assert.equal(ctx.role, "parent", "user_metadata.role 是用户可控字段，绝不能作为角色来源");
  assert.equal(ctx.userId, "u-evil", "userId仍应取 auth user 的 id");
  assert.equal(ctx.fullName, "伪装管理员", "full_name 可信度低但只是展示，用 metadata 无妨");
});

test("profiles 存在时, 角色以 profiles 为准（忽略 metadata 干扰）", async () => {
  authUserResult = {
    data: {
      user: {
        id: "u-teacher",
        email: "t@example.com",
        // 就算 metadata 里写着 admin，profiles 说自己是 teacher 就只能是 teacher
        user_metadata: { role: "admin", full_name: ".metadata 名字" },
      },
    },
    error: null,
  };
  profileResult = {
    data: { id: "u-teacher", role: "teacher", full_name: "profiles 名字", branch_id: "b1" },
    error: null,
  };

  const req = fakeReq();
  const ctx = await requireAuth(req, fakeRes());

  assert.equal(ctx.role, "teacher");
  assert.equal(ctx.fullName, "profiles 名字");
  assert.equal(ctx.branchId, "b1");
});

test("profiles 缺失且 metadata 也没有 role 时, 同样是 parent（不是 undefined）", async () => {
  authUserResult = { data: { user: { id: "u-x", email: "x@example.com" } }, error: null };
  profileResult = { data: null, error: null };

  const req = fakeReq();
  const ctx = await requireAuth(req, fakeRes());

  assert.equal(
    ctx.role,
    "parent",
    "角色缺失时必须有确定值，不能是 undefined 让requireRole 形同虚设",
  );
});

test("token 无效时抛 401", async () => {
  authUserResult = { data: { user: null }, error: { message: "bad jwt" } };
  const res = fakeRes();
  await assert.rejects(() => requireAuth(fakeReq(), res));
  assert.equal(res._captured.statusCode, 401);
});

test("缺失档案时不能从用户 metadata 获取校区", async () => {
  authUserResult = {
    data: { user: { id: "u-x", user_metadata: { branch_id: "other-branch" } } },
    error: null,
  };
  profileResult = { data: null, error: null };
  const ctx = await requireAuth(fakeReq(), fakeRes());
  assert.equal(ctx.branchId, null);
});

test("档案查询失败时拒绝继续认证，不降级为家长", async () => {
  authUserResult = { data: { user: { id: "u-x" } }, error: null };
  const error = new Error("database unavailable");
  profileResult = { data: null, error };
  const req = fakeReq();
  await assert.rejects(() => requireAuth(req, fakeRes()), /database unavailable/);
  assert.equal(req.context, undefined);
});

test("test portal administrator requires trusted app metadata and a classified profile", async()=>{
  authUserResult={data:{user:{id:'test-admin',app_metadata:{is_test_admin:true}}},error:null};
  profileResult={data:{id:'test-admin',role:'parent',is_test:true},error:null};
  const ctx=await requireAuth(fakeReq(),fakeRes());
  assert.equal(ctx.role,'admin');assert.equal(ctx.isTestAccount,true);
});
test("user metadata cannot grant test portal privileges",async()=>{
  authUserResult={data:{user:{id:'test-parent',user_metadata:{is_test_admin:true}}},error:null};
  profileResult={data:{id:'test-parent',role:'parent',is_test:true},error:null};
  assert.equal((await requireAuth(fakeReq(),fakeRes())).role,'parent');
});
test("test administrator metadata cannot promote a production profile",async()=>{
  authUserResult={data:{user:{id:'formal-parent',app_metadata:{is_test_admin:true}}},error:null};
  profileResult={data:{id:'formal-parent',role:'parent',is_test:false},error:null};
  assert.equal((await requireAuth(fakeReq(),fakeRes())).role,'parent');
});
