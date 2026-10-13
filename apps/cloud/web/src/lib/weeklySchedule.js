export function expandWeekly({ startInput, weeks, intervalWeeks = 1, slots }) {
  const day = startInput.slice(0, 10),
    midnight = Date.parse(day + "T00:00:00+08:00");
  if (
    !Number.isFinite(midnight) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 52 ||
    ![1, 2].includes(intervalWeeks) ||
    !slots.length
  )
    throw new Error("请选择有效日期、周数和上课日");
  const weekday = new Date(midnight + 8 * 3600000).getUTCDay(),
    monday = midnight - ((weekday + 6) % 7) * 86400000,
    events = [];
  for (let w = 0; w <= weeks; w++)
    for (const slot of slots) {
      if (
        !Number.isInteger(slot.weekday) ||
        slot.weekday < 0 ||
        slot.weekday > 6 ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)
      )
        throw new Error("上课时间无效");
      const at = monday + (w * intervalWeeks * 7 + ((slot.weekday + 6) % 7)) * 86400000;
      if (at < midnight || at >= midnight + weeks * intervalWeeks * 7 * 86400000) continue;
      const date = new Date(at + 8 * 3600000).toISOString().slice(0, 10);
      events.push(new Date(date + "T" + slot.time + ":00+08:00").toISOString());
    }
  return [...new Set(events)].sort();
}
