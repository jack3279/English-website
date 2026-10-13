# Cloud（公网版）

单租户公网部署版英语外教管理系统。整体架构、本地开发与 Cloudflare 部署说明见仓库根
[README](../../README.md)。

- `web/`：Vite + React 19 + TanStack Query，部署到 Cloudflare Pages
- `api/`：Cloudflare Worker BFF（`src/worker.js` 为入口，`routes/*` 为业务路由）

## 演示账号（仅本地 / 演示环境）

| 角色     | 邮箱                  | 密码      |
| -------- | --------------------- | --------- |
| 管理员   | admin@17say.org       | Demo1234! |
| 外教老师 | emma@17say.org        | Demo1234! |
| 家长     | lilyparent@17say.org  | Demo1234! |

> 正式环境不要使用演示口令；`Demo1234!` 已被后端禁止用于删除学员等敏感操作的二次确认。

## 本地

```bash
# 仓库根
supabase start
supabase db reset
node supabase/scripts/seed-users.mjs
pnpm dev
```

- web: http://localhost:5174
- api 本地由 `apps/cloud/api/dev-server.js` 起纯 Node 服务，绕开 `wrangler dev` 登录。
  api 本地密钥复制 `.dev.vars.example` 为 `.dev.vars` 填写（该文件不入库）。
