// 测试 setup: 用 mock supabase client 替换 lib/supabase.js, 让 unit test 不连真 db.
// 集成测试 (test/integration/*) 应设 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env, 用真 supabase.

const path = require("node:path");
const {
  mockClient,
  setMockResult,
  setMockResults,
  resetMock,
  getQueryLog,
} = require("./mockSupabase.js");

// 替换 lib/supabase.js 的 require cache entry
const supabasePath = path.join(__dirname, "..", "lib", "supabase.js");
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getAdmin: () => mockClient,
    getUserClient: () => mockClient,
    // 登录/注册走一次性客户端(避免 session 污染共享 admin 客户端)。
    // 之前这里没导出它, 导致 auth.js 在单测里一调用就 TypeError —— 登录路由根本测不了。
    createAuthClient: () => mockClient,
  },
};

// 替换 lib/auth.js 的 requireAuth/requireRole, 让测试可通过 req.__testUser 注入 user
const authPath = path.join(__dirname, "..", "lib", "auth.js");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: async (req, res) => {
      const u = req.__testUser;
      if (!u) {
        const err = new Error("缺少 Authorization 头");
        err.status = 401;
        err.code = "UNAUTHORIZED";
        res.status(401).json({ error: "缺少 Authorization 头", code: "UNAUTHORIZED" });
        throw err;
      }
      req.context = {
        userId: u.id,
        role: u.role,
        fullName: u.full_name,
        branchId: u.branch_id || null,
        jwt: req.headers["authorization"] || "test-jwt",
        supabase: mockClient,
      };
      return req.context;
    },
    optionalAuth: async (req) => {
      const u = req.__testUser;
      if (!u) return null;
      req.context = {
        userId: u.id,
        role: u.role,
        fullName: u.full_name,
        branchId: u.branch_id || null,
        jwt: req.headers["authorization"] || "test-jwt",
        supabase: mockClient,
      };
      return req.context;
    },
    requireRole: (req, res, ...allowed) => {
      if (!allowed.includes(req.context?.role)) {
        const err = new Error(`需要角色: ${allowed.join("/")}`);
        err.status = 403;
        err.code = "FORBIDDEN";
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        throw err;
      }
    },
  },
};

module.exports = { setMockResult, setMockResults, resetMock, getQueryLog };
