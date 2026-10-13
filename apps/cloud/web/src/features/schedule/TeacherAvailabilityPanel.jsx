import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";
import { uiT, useUiLanguage } from "../../i18n/store.js";
import { useSchedule } from "./useSchedule.js";
import { schoolDay } from "./scheduleInsights.js";
import { Button } from "../../components/ui/button.jsx";
const days = [1, 2, 3, 4, 5, 6, 0],
  labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const input = "rounded border bg-white p-2 dark:border-gray-700 dark:bg-gray-900";
const minute = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export default function TeacherAvailabilityPanel({ anchor, onSelect }) {
  useUiLanguage();
  const { user } = useAuth(),
    qc = useQueryClient(),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState(null),
    [edit, setEdit] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [allDay, setAllDay] = useState(false);
  const teachers = useQuery({
    queryKey: ["availability-teachers"],
    queryFn: async () => (await http("/teachers")).data,
  });
  const teacherList = Array.isArray(teachers.data) ? teachers.data : [];
  const id = user?.role === "teacher" ? user.id : selected || teacherList[0]?.profile_id;
  const cfg = useQuery({
    queryKey: ["teacher-availability", id],
    enabled: !!id,
    queryFn: async () => (await http("/teacher-availability/" + id)).data,
  });
  const data = draft || cfg.data || { revision: 0, available: [], weeklyBusy: [], busy: [] };
  const anchorDay = schoolDay(anchor.toISOString()),
    anchorMidnight = Date.parse(anchorDay + "T00:00:00+08:00"),
    anchorWeekday = new Date(anchorMidnight + 8 * 3600000).getUTCDay();
  const start = schoolDay(
      new Date(anchorMidnight - ((anchorWeekday + 6) % 7) * 86400000).toISOString(),
    ),
    end = schoolDay(new Date(Date.parse(start + "T00:00:00+08:00") + 7 * 86400000).toISOString());
  const schedule = useSchedule({
    from: start + "T00:00:00+08:00",
    to: end + "T00:00:00+08:00",
    teacherId: id,
    enabled: !!id,
  });
  async function save() {
    setSaving(true);
    setError("");
    try {
      await http("/teacher-availability/" + id, { method: "POST", body: data });
      setDraft(null);
      setEdit(false);
      await qc.invalidateQueries({ queryKey: ["teacher-availability"] });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function set(field, rows) {
    setDraft({ ...data, [field]: rows });
  }
  function weekly(field) {
    return (
      <div className="space-y-2">
        <h3 className="font-medium">
          {uiT(field === "available" ? "每周可用时间" : "每周固定占用")}
        </h3>
        {data[field].map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={uiT("星期")}
              className={input}
              value={r.weekday}
              onChange={(e) =>
                set(
                  field,
                  data[field].map((x, j) =>
                    j === i ? { ...x, weekday: Number(e.target.value) } : x,
                  ),
                )
              }
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {uiT(labels[d])}
                </option>
              ))}
            </select>
            <input
              aria-label={uiT("开始时间")}
              className={input}
              type="time"
              value={r.start}
              onChange={(e) =>
                set(
                  field,
                  data[field].map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                )
              }
            />
            <span>—</span>
            <input
              aria-label={uiT("结束时间")}
              className={input}
              type="time"
              value={r.end}
              onChange={(e) =>
                set(
                  field,
                  data[field].map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                )
              }
            />
            <Button
              variant="ghost"
              onClick={() =>
                set(
                  field,
                  data[field].filter((_, j) => j !== i),
                )
              }
            >
              {uiT("删除")}
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() => set(field, [...data[field], { weekday: 1, start: "09:00", end: "18:00" }])}
        >
          {uiT("添加时段")}
        </Button>
      </div>
    );
  }
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(start + "T00:00:00+08:00") + i * 86400000).toISOString(),
  );
  const times = Array.from({ length: allDay ? 48 : 28 }, (_, i) => (allDay ? 0 : 8 * 60) + i * 30);
  return (
    <section className="space-y-4 rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{uiT("教师可用时间与个人占用")}</h2>
        <div className="flex gap-2">
          {user?.role === "admin" && (
            <select
              aria-label={uiT("选择教师")}
              className={input}
              value={id || ""}
              onChange={(e) => {
                setSelected(e.target.value);
                setDraft(null);
                setEdit(false);
              }}
            >
              {teacherList.map((t) => (
                <option key={t.profile_id} value={t.profile_id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          )}
          <Button
            disabled={!cfg.data}
            variant="outline"
            onClick={() => {
              setDraft(structuredClone(cfg.data));
              setEdit(!edit);
            }}
          >
            {uiT("设置时间")}
          </Button>
        </div>
      </div>
      {(error || cfg.error || schedule.error || teachers.error) && (
        <p role="alert" className="text-red-600">
          {error || cfg.error?.message || schedule.error?.message || teachers.error?.message}
        </p>
      )}
      {edit && (
        <div className="space-y-5 rounded-lg border p-3 dark:border-gray-700">
          {weekly("available")}
          {weekly("weeklyBusy")}
          <h3 className="font-medium">{uiT("特定日期个人占用")}</h3>
          {data.busy.map((b, i) => (
            <div key={b.id} className="flex flex-wrap gap-2">
              <input
                aria-label={uiT("占用开始")}
                className={input}
                type="datetime-local"
                value={new Date(Date.parse(b.from) + 8 * 3600000).toISOString().slice(0, 16)}
                onChange={(e) =>
                  set(
                    "busy",
                    data.busy.map((x, j) =>
                      j === i
                        ? { ...x, from: new Date(e.target.value + ":00+08:00").toISOString() }
                        : x,
                    ),
                  )
                }
              />
              <input
                aria-label={uiT("占用结束")}
                className={input}
                type="datetime-local"
                value={new Date(Date.parse(b.to) + 8 * 3600000).toISOString().slice(0, 16)}
                onChange={(e) =>
                  set(
                    "busy",
                    data.busy.map((x, j) =>
                      j === i
                        ? { ...x, to: new Date(e.target.value + ":00+08:00").toISOString() }
                        : x,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                onClick={() =>
                  set(
                    "busy",
                    data.busy.filter((_, j) => j !== i),
                  )
                }
              >
                {uiT("删除")}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() =>
              set("busy", [
                ...data.busy,
                {
                  id: crypto.randomUUID(),
                  from: new Date().toISOString(),
                  to: new Date(Date.now() + 3600000).toISOString(),
                  note: "",
                },
              ])
            }
          >
            {uiT("添加个人占用")}
          </Button>
          <p className="text-xs text-gray-500">
            {uiT("所有时间按北京时间设置。没有配置可用时段时，仅检查课程与个人占用，不标记空闲。")}
          </p>
          <Button disabled={saving} onClick={save}>
            {uiT("保存时间设置")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
          {uiT("空闲可排课")}
        </span>
        <span className="rounded bg-blue-100 px-2 py-1 text-blue-900 dark:bg-blue-900 dark:text-blue-100">
          {uiT("已排学生课程")}
        </span>
        <span className="rounded bg-rose-100 px-2 py-1 text-rose-900 dark:bg-rose-900 dark:text-rose-100">
          {uiT("个人占用")}
        </span>
        <span>{uiT("灰色：不可用或未设置")}</span>
        <label className="ml-auto flex gap-1">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          {uiT("显示全天")}
        </label>
      </div>
      {cfg.data?.available?.length > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          <p>{uiT("每周可用范围（需扣除课程和个人占用）")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {cfg.data.available.map((a, i) => (
              <span key={i} className="rounded border px-2 py-1 dark:border-gray-700">
                {uiT(labels[a.weekday])} {a.start}–{a.end}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {uiT("每格30分钟，可左右滑动查看各天；保存排课时会按完整课长重新核对。")}
      </p>
      {!cfg.data || schedule.isPending ? (
        <p>{uiT("正在读取时间表…")}</p>
      ) : (
        <div className="max-h-[540px] overflow-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-1 text-xs">
            <thead className="sticky top-0 bg-white dark:bg-gray-900">
              <tr>
                <th>{uiT("北京时间")}</th>
                {dates.map((d) => (
                  <th key={d}>
                    {schoolDay(d)} {uiT(labels[new Date(Date.parse(d) + 8 * 3600000).getUTCDay()])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((m) => (
                <tr key={m}>
                  <th>
                    {String(Math.floor(m / 60)).padStart(2, "0")}:{String(m % 60).padStart(2, "0")}
                  </th>
                  {dates.map((d) => {
                    const date = schoolDay(d),
                      from = Date.parse(date + "T00:00:00+08:00") + m * 60000,
                      to = from + 30 * 60000,
                      weekday = new Date(from + 8 * 3600000).getUTCDay(),
                      occupied =
                        cfg.data.busy.some(
                          (b) => Date.parse(b.from) < to && Date.parse(b.to) > from,
                        ) ||
                        cfg.data.weeklyBusy.some(
                          (b) =>
                            b.weekday === weekday && minute(b.start) < m + 30 && minute(b.end) > m,
                        ),
                      lesson = (schedule.data || []).find(
                        (l) =>
                          !["cancelled", "no_show"].includes(l.status) &&
                          Date.parse(l.scheduled_at) < to &&
                          Date.parse(l.scheduled_at) + l.duration_min * 60000 > from,
                      ),
                      available = cfg.data.available.some(
                        (a) =>
                          a.weekday === weekday && minute(a.start) <= m && minute(a.end) >= m + 30,
                      ),
                      state = lesson
                        ? "booked"
                        : occupied
                          ? "busy"
                          : available
                            ? "free"
                            : "unknown";
                    return (
                      <td key={d}>
                        <button
                          disabled={state !== "free" || !onSelect}
                          onClick={() =>
                            onSelect({
                              teacher_id: id,
                              scheduled_at:
                                date +
                                "T" +
                                String(Math.floor(m / 60)).padStart(2, "0") +
                                ":" +
                                String(m % 60).padStart(2, "0"),
                            })
                          }
                          title={
                            lesson?.students?.full_name ||
                            uiT(
                              state === "free"
                                ? "空闲可排课"
                                : state === "busy"
                                  ? "个人占用"
                                  : "不可用或未设置",
                            )
                          }
                          className={
                            "w-full min-h-7 rounded px-1 " +
                            {
                              free: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
                              booked:
                                "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
                              busy: "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
                              unknown:
                                "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
                            }[state]
                          }
                        >
                          {lesson?.students?.full_name ||
                            uiT(state === "free" ? "空闲" : state === "busy" ? "占用" : "—")}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
