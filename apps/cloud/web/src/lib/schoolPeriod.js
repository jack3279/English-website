import { schoolDay } from "../features/schedule/scheduleInsights.js";
export function schoolPeriod(key, now = Date.now()) {
  const day = schoolDay(new Date(now)),
    [year, month] = day.slice(0, 7).split("-").map(Number);
  if (key === "this_week" || key === "last_week") {
    const d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - (key === "last_week" ? 7 : 0));
    const from = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    return { from, to: d.toISOString().slice(0, 10) };
  }
  if (key === "all") return { from: null, to: null };
  if (key === "this_month") return { from: `${day.slice(0, 7)}-01`, to: day };
  if (key === "last_month")
    return {
      from: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
    };
  const days = key === "last_90" ? 90 : Number(key);
  return { from: schoolDay(new Date(now - (days - 1) * 86400000)), to: day };
}
