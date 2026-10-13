import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";

export default function AdminStats() {
  const { data: students = [] } = useQuery({
    queryKey: ["students", { all: true }],
    queryFn: async () => (await http("/students?pageSize=100")).data,
  });
  const { data: lessons = [] } = useQuery({
    queryKey: ["admin-today-lessons"],
    queryFn: async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      to.setHours(23, 59, 59, 999);
      return (await http(`/schedules?from=${from.toISOString()}&to=${to.toISOString()}`)).data;
    },
  });

  const lowBalance = students.filter((s) => s.remaining_hours < 3).length;
  const todayCount = lessons.length;
  const completed = lessons.filter((l) => l.status === "completed").length;

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}
    >
      <div
        style={{ padding: 16, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}
      >
        <div style={{ color: "#6b7280", fontSize: 12 }}>今日课次</div>
        <div style={{ fontSize: 24, fontWeight: 600 }}>{todayCount}</div>
      </div>
      <div
        style={{ padding: 16, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}
      >
        <div style={{ color: "#6b7280", fontSize: 12 }}>今日已完成</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: "#10b981" }}>{completed}</div>
      </div>
      <div
        style={{ padding: 16, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}
      >
        <div style={{ color: "#6b7280", fontSize: 12 }}>低余额学员(&lt;3h)</div>
        <div
          style={{ fontSize: 24, fontWeight: 600, color: lowBalance > 0 ? "#dc2626" : "#10b981" }}
        >
          {lowBalance}
        </div>
      </div>
    </div>
  );
}
