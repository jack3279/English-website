# @cloud/domain

纯函数业务规则包，前后端共用。无 IO 依赖。

- `lessonDelivery.compute()` — 完成一节课的副作用计算
- `scheduleConflict.detect()` — 排课冲突检测
- `errors.*` — 领域错误类

## 测试

```powershell
pnpm --filter @cloud/domain test
```
