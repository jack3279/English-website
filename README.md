# English-website（英语外教管理系统 · 公网版）

单租户公网部署的英语外教培训班管理系统，面向管理员、外教、家长三类角色，
覆盖招生线索、学员档案、排课/点名、请假补课、课时包与财务、薪酬、站内通知与企微提醒、
自动加密备份等业务。

- 前端：**Cloudflare Pages** + Vite + React 19 + TanStack Query（`apps/cloud/web`）
- 后端：**Cloudflare Workers** + Supabase（Postgres / Auth）（`apps/cloud/api`）
- 数据库迁移与初始化脚本：`supabase/`
- 共享领域逻辑 / 数据契约：`packages/domain`、`packages/schema`
- 端到端测试：`e2e/`（Playwright）

> 本仓库只包含公网网站版本，不含历史本地桌面版（Electron）代码。

## 目录结构

```
apps/cloud/web       前端（Vite + React），部署到 Cloudflare Pages
apps/cloud/api       后端 Worker（src/worker.js 为入口，routes/* 为业务路由）
packages/domain      与框架无关的领域逻辑
packages/schema      数据结构 / 校验契约
supabase/            init.sql、migrations、policies、一次性运维脚本
e2e/                 Playwright 端到端测试
.github/workflows/cloud.yml   云端 CI（测试 + 构建校验，不自动部署）
```

## 本地开发

前置：Node.js ≥ 18、pnpm 9、Docker Desktop（跑本地 Supabase）、Supabase CLI。

```bash
pnpm install

# 启动本地 Supabase 并初始化库
supabase start
supabase db reset
node supabase/scripts/seed-users.mjs

# 同时起前端(5174)与后端(本地)
pnpm dev
```

后端本地配置见 `apps/cloud/api/.dev.vars.example`（复制为 `.dev.vars`，填入本地 Supabase URL /
service role key / anon key）；前端配置见 `apps/cloud/web/.env.example`。

> 注意：service role key 是绕过 RLS 的最高权限密钥，只允许存在于 Worker secrets / 本地
> `.dev.vars`，绝不能放进前端或提交到仓库。

## 测试

```bash
pnpm test          # domain + schema + api（node:test）
pnpm test:web      # 前端（Vitest + Testing Library）
pnpm --filter @cloud/web build
```

## 部署（Cloudflare）

后端 Worker 与前端 Pages 均通过 wrangler 发布；密钥用 `wrangler secret put` 配置，
不写入仓库。`apps/cloud/api/wrangler.toml` 只保存非密配置（域名、cron、R2 绑定）。

```bash
# 一次性：wrangler login

# 1) 先在 Supabase SQL Editor 按顺序执行 supabase/migrations 下的迁移
# 2) 部署后端
pnpm deploy:api
# 3) 构建并部署前端
pnpm deploy:web
```

后端需要的 secrets：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`、
`ENCRYPTION_KEY`（私有配置/备份加密；旧名 `PUSHPLUS_ENCRYPTION_KEY` 兼容），
以及可选的企业微信 `WECHAT_*` 配置。

生产域名：

- 网站：https://17say.org ，https://www.17say.org
- 接口：https://api.17say.org

## 学员状态与删除

学员有五种状态：在读 `active`、停课 `inactive`、休学 `leave`、结课 `graduated`、退费 `refunded`。
仅「在读」参与低余额、续费、次日课程等提醒。删除学员用于清理假数据，是数据库内单事务的
级联永久删除（需管理员密码二次确认并写审计），家长/教师账号保留；删除前请确认已有备份。
相关迁移：`supabase/migrations/20261014000003_student_status_and_purge.sql`。
