import { createClient } from "@supabase/supabase-js";
const c = createClient(
  "https://ueuerggzomryvisijdym.supabase.co",
  "sb_secret_iE0C8dfBQH4gWVbP8COrLg_7UNGlZ1m",
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const BRANCH = "00000000-0000-0000-0000-000000000001";
const profiles = [
  {
    id: "a7681e68-a783-4132-9013-dc3974a2d42b",
    role: "admin",
    full_name: "机构管理员",
    branch_id: BRANCH,
  },
  {
    id: "30ed158b-3700-49f3-8241-3dcfed5a3950",
    role: "teacher",
    full_name: "Emma",
    branch_id: BRANCH,
  },
  {
    id: "ff9b0941-e395-4fb0-a579-6a00123030e4",
    role: "teacher",
    full_name: "John",
    branch_id: BRANCH,
  },
  {
    id: "ed770b6d-abeb-4779-83a3-4bbc8c358548",
    role: "parent",
    full_name: "Lily 妈妈",
    branch_id: BRANCH,
  },
];
const r = await c.from("profiles").upsert(profiles).select();
console.log(JSON.stringify({ err: r.error, count: r.data?.length }));
