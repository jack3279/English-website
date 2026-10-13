const { z } = require("zod");
const store = require("./secureStore.js");
const KEY = "private/institution/settings-v1";
function scopedKey(){return require('./dataScope.js').current()?.mode==='test'?KEY+'/test':KEY;}
const DEFAULTS = {
  institutionName: "教学管理",
  defaultDurationMin: 60,
  lowBalanceHours: 3,
  expiryWarnDays: 30,
  leaveDeadlineHours: 4,
  absenceDeductHours: false,
  absencePayTeacher: true,
  renewalPercent: 20,
  renewalMinHours: 2,
  loadLimits: { dailyHours: 6, weeklyHours: 25, consecutiveLessons: 3, breakMinutes: 15 },
};
const Schema = z
  .object({
    institutionName: z.string().trim().min(1).max(50),
    defaultDurationMin: z.number().int().min(15).max(240),
    lowBalanceHours: z.number().min(0.5).max(100),
    expiryWarnDays: z.number().int().min(0).max(365),
    leaveDeadlineHours: z.number().min(0).max(168),
    absenceDeductHours: z.boolean(),
    absencePayTeacher: z.boolean(),
    renewalPercent: z.number().min(1).max(100),
    renewalMinHours: z.number().min(0).max(100),
    loadLimits: z
      .object({
        dailyHours: z.number().min(1).max(24),
        weeklyHours: z.number().min(1).max(168),
        consecutiveLessons: z.number().int().min(2).max(12),
        breakMinutes: z.number().int().min(1).max(60),
      })
      .strict(),
  })
  .strict();
async function getSettings() {
  if (!store.ready()) return structuredClone(DEFAULTS);
  const { value } = await store.read(scopedKey(), DEFAULTS);
  return Schema.parse({
    ...DEFAULTS,
    ...value,
    loadLimits: { ...DEFAULTS.loadLimits, ...value.loadLimits },
  });
}
async function updateSettings(input) {
  const checked = Schema.partial().parse(input);
  return store.change(scopedKey(), DEFAULTS, (current) =>
    Schema.parse({ ...DEFAULTS, ...current, ...checked }),
  );
}
module.exports = { DEFAULTS, Schema, getSettings, updateSettings, ready: store.ready };
