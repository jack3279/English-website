import {test,expect} from "vitest";
import {financeRange} from "../src/lib/financeWindow.js";
test("北京时间月初跨UTC日期时，汇总与明细使用本月同一区间",()=>{expect(financeRange("this_month",new Date("2026-09-30T16:30:00Z"))).toEqual({from:"2026-10-01",to:"2026-10-01"});});
test("近30天跨年和季度区间包含北京时间当天",()=>{expect(financeRange("last_30",new Date("2025-12-31T17:00:00Z"))).toEqual({from:"2025-12-03",to:"2026-01-01"});expect(financeRange("quarter",new Date("2026-10-09T10:00:00Z"))).toEqual({from:"2026-10-01",to:"2026-10-09"});});
