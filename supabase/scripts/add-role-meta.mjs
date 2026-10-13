// 给所有 demo user 添加 role 到 user_metadata
// 双击运行, 或 node add-role-meta.mjs
import { createClient } from "@supabase/supabase-js";

const url = "https://ueuerggzomryvisijdym.supabase.co";
const key = "sb_secret_iE0C8dfBQH4gWVbP8COrLg_7UNGlZ1m";
const c = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const updates = [
  ["a7681e68-a783-4132-9013-dc3974a2d42b", "admin", "13800000001"],
  ["30ed158b-3700-49f3-8241-3dcfed5a3950", "teacher", "13800000002"],
  ["ff9b0941-e395-4fb0-a579-6a00123030e4", "teacher", "13800000003"],
  ["ed770b6d-abeb-4779-83a3-4bbc8c358548", "parent", "13800000004"],
  ["a32a7d8a-a40f-4da1-834e-7280a8bceb24", "parent", "13900000001"],
  ["bd5e2234-84e9-4e89-9362-1c4961805352", "parent", "13900000002"],
  ["ad5b42f5-7045-4cbd-833f-4ad0b0574cc6", "parent", "13900000003"],
];

(async () => {
  for (const [id, role, phone] of updates) {
    const u = await c.auth.admin.getUserById(id);
    if (u.error || !u.data?.user) {
      console.log(id, "err:", u.error?.message || "not found");
      continue;
    }
    const newMeta = {
      ...u.data.user.user_metadata,
      role,
      branch_id: "00000000-0000-0000-0000-000000000001",
      phone,
    };
    const r = await c.auth.admin.updateUserById(id, { user_metadata: newMeta });
    if (r.error) console.log(id, "update err:", r.error.message);
    else console.log(id, "updated role=" + role);
  }
  console.log("done");
})().catch((e) => {
  console.error("TOP ERR:", e);
  process.exit(1);
});
