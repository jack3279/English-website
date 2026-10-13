const LOW_HOURS_THRESHOLD = 3;
const {getSettings}=require("./institutionSettings.js");

async function loadBalances(admin) {
  // 与学员详情共用余额视图，包含消课和手工调整；不能先筛选单个课时包再相加。
  const { data: students, error: studentError } = await admin
    .from("students")
    .select("id, full_name")
    .eq("status", "active")
    .order("full_name");
  if (studentError) throw studentError;
  if (!students?.length) return [];
  const { data: balances, error } = await admin
    .from("student_balance")
    .select("student_id, remaining_hours")
    .in(
      "student_id",
      students.map((s) => s.id),
    );
  if (error) throw error;
  const byStudent = new Map((balances ?? []).map((b) => [b.student_id, Number(b.remaining_hours)]));
  return students
    .map((s) => ({
      id: s.id,
      student_id: s.id,
      full_name: s.full_name,
      remaining_hours: byStudent.get(s.id) ?? 0,
    }))
    .sort((a, b) => a.remaining_hours - b.remaining_hours);
}

async function getLowBalanceStudents(admin) {
  const {lowBalanceHours}=await getSettings();
  return (await loadBalances(admin)).filter(
    (s) => s.remaining_hours > 0 && s.remaining_hours < lowBalanceHours,
  );
}

async function getZeroBalanceStudents(admin) {
  return (await loadBalances(admin)).filter((s) => s.remaining_hours <= 0);
}

async function getDailyLowBalanceReport(admin) {
  const {lowBalanceHours}=await getSettings();
  const rows = await loadBalances(admin);
  const low = rows.filter((s) => s.remaining_hours > 0 && s.remaining_hours < lowBalanceHours);
  const zero = rows.filter((s) => s.remaining_hours <= 0);
  return {
    low_balance: low,
    zero_balance: zero,
    threshold: lowBalanceHours,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getLowBalanceStudents,
  getZeroBalanceStudents,
  getDailyLowBalanceReport,
  LOW_HOURS_THRESHOLD,
};
