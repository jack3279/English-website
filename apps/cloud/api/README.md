# @cloud/api

Vercel Functions BFF，参见根目录 spec/plan。

## 本地起

```powershell
# 设环境变量
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY = '<from supabase status>'
$env:SUPABASE_ANON_KEY = '<from supabase status>'

pnpm dev  # vercel dev
```

## 测试

```powershell
pnpm test
```

健康检查: http://localhost:3001/api/health
