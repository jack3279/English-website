# @cloud/e2e

Playwright E2E tests for cloud-web.

## 准备

1. 启动 supabase 本地 (从仓库根):

   ```
   supabase start
   supabase db reset
   node supabase/scripts/seed-users.mjs
   ```

2. 起 cloud (从仓库根):

   ```
   pnpm dev:cloud
   ```
   - web: http://localhost:5174
   - api: http://localhost:3001

3. 装 Playwright 浏览器 (一次性):
   ```
   cd e2e
   npx playwright install chromium
   ```

## 跑测试

```
cd e2e
pnpm test           # headless
pnpm test:headed    # 看浏览器
```

`E2E_BASE_URL` 环境变量可以覆盖 baseURL (默认 `http://127.0.0.1:5174`)。
