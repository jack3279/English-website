import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { findPayrollSettlement, payrollSettlementChanged } from "../../lib/payrollSettlement.js";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { schoolPeriod } from "../../lib/schoolPeriod.js";
import { exportPayrollWorkbook } from "../../lib/xlsx.js";
import { Button } from "../../components/ui/button.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import PayrollSettlementAction from "./PayrollSettlementAction.jsx";
const field = "h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";
const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());
export default function PayrollWorkspace({
  readOnly = false
}) {
  useUiLanguage();
  const [range, setRange] = useState("this_month"),
    [period, setPeriod] = useState("monthly"),
    [from, setFrom] = useState(schoolPeriod("this_month").from),
    [to, setTo] = useState(schoolPeriod("this_month").to),
    [teacher, setTeacher] = useState(""),
    [editing, setEditing] = useState(null),
    [detail, setDetail] = useState(false),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const teachers = useQuery({
    queryKey: ["teachers", "payroll-options"],
    queryFn: async () => (await http("/teachers")).data,
    enabled: !readOnly
  });
  const configs = useQuery({
    queryKey: ["payroll", "pricing"],
    queryFn: async () => (await http("/finance/payroll/pricing")).data,
    enabled: !readOnly
  });
  const settlements = useQuery({
    queryKey: ["finance", "payroll", "settlements"],
    queryFn: async () => (await http("/finance/payroll/settlements")).data
  });
  const report = useQuery({
    queryKey: ["payroll", "report", period, from, to, teacher],
    queryFn: async () => (await http("/finance/payroll/report?" + new URLSearchParams({
      period,
      from,
      to,
      ...(teacher ? {
        teacher_id: teacher
      } : {})
    }))).data
  });
  const rows = report.data?.rows || [],
    details = report.data?.details || [],
    records = settlements.data?.records || [];
  const options = Array.isArray(teachers.data) ? teachers.data : teachers.data?.items || teachers.data?.teachers || [];
  function choose(key) {
    setRange(key);
    if (key === "custom") return;
    const win = schoolPeriod(key);
    setFrom(win.from);
    setTo(win.to);
    if (key.includes("week")) setPeriod("weekly");else setPeriod("monthly");
  }
  async function download() {
    setExporting(true);
    setExportError("");
    try {
      await exportPayrollWorkbook(uiT("课酬统计_{0}_{1}.xlsx", [from, to]), report.data, records);
    } catch (e) {
      setExportError(e.message || uiT("导出失败，请重试"));
    } finally {
      setExporting(false);
    }
  }
  return <section className="space-y-4 text-gray-900 dark:text-gray-100">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{uiT("课酬统计与结算")}</h2>
          <div className="flex gap-2">
            {!readOnly && <Button variant="outline" disabled={teachers.isPending || teachers.isError || configs.isPending || configs.isError} onClick={() => setEditing(teacher || options[0]?.profile_id)}>{" " + uiT("价格设置") + " "}</Button>}
            <Button disabled={report.isPending || report.isError || !rows.length || exporting || settlements.isPending || settlements.isError} onClick={download}>
              {exporting ? uiT("导出中…") : uiT("导出 Excel")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="text-sm">{" " + uiT("统计范围") + " "}<select aria-label={uiT("统计范围")} className={field} value={range} onChange={e => choose(e.target.value)}>
              {[["this_week", uiT("本周")], ["last_week", uiT("上周")], ["this_month", uiT("本月")], ["last_month", uiT("上月")], ["90", uiT("近90天")], ["custom", uiT("自定义")]].map(([v, n]) => <option key={v} value={v}>
                  {n}
                </option>)}
            </select>
          </label>
          <label className="text-sm">{" " + uiT("汇总周期") + " "}<select aria-label={uiT("汇总周期")} className={field} value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="weekly">{uiT("每周（周一至周日）")}</option>
              <option value="monthly">{uiT("每月（自然月）")}</option>
            </select>
          </label>
          <label className="text-sm">{" " + uiT("开始日期") + " "}<input aria-label={uiT("开始日期")} type="date" className={field} value={from} onChange={e => {
            setRange("custom");
            setFrom(e.target.value);
          }} />
          </label>
          <label className="text-sm">{" " + uiT("结束日期") + " "}<input aria-label={uiT("结束日期")} type="date" className={field} value={to} onChange={e => {
            setRange("custom");
            setTo(e.target.value);
          }} />
          </label>
          {!readOnly && <label className="text-sm">{" " + uiT("教师") + " "}<select aria-label={uiT("教师筛选")} className={field} value={teacher} onChange={e => setTeacher(e.target.value)}>
                <option value="">{uiT("全部教师")}</option>
                {options.map(t => <option key={t.profile_id} value={t.profile_id}>
                    {t.full_name}
                  </option>)}
              </select>
            </label>}
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">{" " + uiT("按北京时间统计已上课及计酬缺勤课程。学生金额为约定价统计，不代表实收；不同币种分别汇总。本页应计金额不代表已发放。每小时按60分钟折算。登记发放前会重新核对完整周/月，并检查重复周期。") + " "}</p>
        {report.data?.pending_absences>0&&<p role="status" className="text-warning-700 dark:text-warning-300">{uiT("本周期有 {0} 节缺勤结算待管理员确认，确认后才能登记发放。",[report.data.pending_absences])}</p>}
        {(exportError || teachers.isError || configs.isError || settlements.isError) && <p role="alert" className="text-danger-600 dark:text-danger-400">
            {exportError || uiT("设置或发放记录读取失败，请刷新重试；统计金额不能据此视为已核对。")}
          </p>}
      </Card>
      {report.isPending ? <Card className="p-6">{uiT("正在读取课酬明细…")}</Card> : report.isError ? <Card className="p-6">
          <p role="alert">{report.error.message || uiT("统计读取失败")}</p>
          <Button onClick={() => report.refetch()}>{uiT("重试")}</Button>
        </Card> : <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-sm">{uiT("已完课 / 小时")}</p>
              <strong className="text-xl">
                {report.data?.totals.lessons_done} / {report.data?.totals.hours}
              </strong>
            </Card>
            {Object.entries(report.data?.totals.by_currency || {}).map(([currency, amount]) => <Card key={currency} className="p-4">
                <p className="text-sm">{uiT("应计课酬 ·") + " "}{currency}</p>
                <strong className="text-xl">{Number(amount).toFixed(2)}</strong>
              </Card>)}
          </div>
          <Card className="p-4">
            <h3 className="font-semibold mb-3">{uiT("教师结算汇总")}</h3>
            <div className="hidden lg:grid grid-cols-6 gap-3 px-3 pb-2 text-xs text-gray-600 dark:text-gray-400">
              <span>{uiT("教师 / 约定周期")}</span>
              <span>{uiT("统计周期")}</span>
              <span>{uiT("计酬课次 / 小时")}</span>
              <span>{uiT("应计课酬")}</span>
              <span>{uiT("统计范围")}</span>
              <span>{uiT("发放登记")}</span>
            </div>
            {!rows.length ? <p>{uiT("该日期范围没有已完课课程。")}</p> : <div className="space-y-3">
                {rows.map(r => <div key={[r.teacher_id, r.period_from, r.pay_currency].join("|")} className="grid grid-cols-2 lg:grid-cols-6 gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div>
                      <strong>{r.teacher_name}</strong>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{" " + uiT("约定")}{r.cycle === "weekly" ? uiT("周结") : uiT("月结")}
                      </p>
                    </div>
                    <div className="text-sm">
                      {r.period_from}
                      <br />
                      {r.period_to}
                    </div>
                    <div>
                      {r.lessons_done}{" " + uiT("节 ·") + " "}{(r.minutes_done / 60).toFixed(2)}{" " + uiT("小时") + " "}</div>
                    <div className="font-semibold">
                      {r.pay_amount.toFixed(2)} {r.pay_currency}
                    </div>
                    <div className="text-sm">
                      {from > r.period_from || to < r.period_to ? uiT("仅所选日期，非完整周期") : uiT("完整周期")}
                    </div>
                    {readOnly ? <div>
                        {findPayrollSettlement(r, records)?.state === "paid" ? payrollSettlementChanged(r, findPayrollSettlement(r, records)) ? uiT("金额或课程变化待核对") : uiT("已登记发放") : uiT("待登记")}
                      </div> : <PayrollSettlementAction row={r} records={records} disabled={settlements.isPending || settlements.isError || !report.data?.storageReady || from > r.period_from || to < r.period_to} />}
                  </div>)}
              </div>}
          </Card>
          <Card className="p-4">
            <Button variant="outline" onClick={() => setDetail(!detail)}>
              {detail ? uiT("收起") : uiT("查看")}{uiT("课程计价明细（")}{details.length}）
            </Button>
            {detail && <div className="mt-3 space-y-2">
                {details.map(d => <div key={d.lesson_id} className="border-b border-gray-200 dark:border-gray-700 pb-3 text-sm">
                    <div className="font-medium">
                      {uiT(d.attendance_status==="no_show"?(d.pay_amount>0?"缺勤（计酬）":"缺勤（不计酬）"):"上课")} · {d.day} · {d.teacher_name} · {d.student_name} · {d.course_name}
                    </div>
                    <div className="text-gray-600 dark:text-gray-400">
                      {d.duration_min}{uiT("分钟 · 教师") + " "}{d.hourly_pay.toFixed(2)} {d.pay_currency}{uiT("/小时 →")}{" "}
                      {d.pay_amount.toFixed(2)} {d.pay_currency}
                      {!readOnly && <>
                          {" "}{" " + uiT("· 学生")}{" "}
                          {d.student_price == null ? uiT("未设置约定价") : uiT("¥{0}/小时 → ¥{1}", [d.student_price.toFixed(2), d.student_amount.toFixed(2)])}
                        </>}
                      {d.legacy ? uiT(" · 历史课程") : ""}
                    </div>
                  </div>)}
              </div>}
          </Card>
        </>}
      {editing && <PricingDialog teacherId={editing} onTeacher={setEditing} options={options} config={configs.data?.teachers?.[editing]} onClose={() => setEditing(null)} />}
    </section>;
}
function PricingDialog({
  teacherId,
  onTeacher,
  options,
  config,
  onClose
}) {
  useUiLanguage();
  const qc = useQueryClient(),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const teacher = options.find(t => t.profile_id === teacherId) || {};
  const value = draft || {
    hourly_pay: config?.hourly_pay ?? teacher.hourly_pay ?? 0,
    currency: config?.currency || teacher.pay_currency || "PHP",
    cycle: config?.cycle || "monthly",
    rules: config?.rules || [],
    revision: config?.revision || 0
  };
  const courses = useQuery({
    queryKey: ["courses", "pricing-options"],
    queryFn: async () => (await http("/courses")).data
  });
  const students = useQuery({
    queryKey: ["students", "pricing-options"],
    queryFn: async () => {
      const all = [];
      for (let page = 1; page <= 100; page++) {
        const result = await http(`/students?pageSize=100&page=${page}`);
        const rows = Array.isArray(result.data) ? result.data : result.data?.items || [];
        all.push(...rows);
        if (rows.length < 100) return all;
      }
      throw new Error(uiT("学生数量较大，请缩小范围"));
    }
  });
  const courseOptions = (courses.data?.items || []).filter(c => c.teacher_id === teacherId);
  const studentOptions = Array.isArray(students.data) ? students.data : students.data?.items || [];
  const change = patch => setDraft({
    ...value,
    ...patch
  });
  const update = (i, patch) => change({
    rules: value.rules.map((r, j) => j === i ? {
      ...r,
      ...patch
    } : r)
  });
  async function save() {
    setBusy(true);
    setError("");
    try {
      await http("/finance/payroll/pricing", {
        method: "POST",
        body: {
          ...value,
          teacher_id: teacherId
        }
      });
      await qc.invalidateQueries({
        queryKey: ["payroll"]
      });
      await qc.invalidateQueries({
        queryKey: ["teachers"]
      });
      onClose();
    } catch (e) {
      setError(e.message || uiT("保存失败"));
    } finally {
      setBusy(false);
    }
  }
  return <Dialog open size="lg" title={uiT("教师及学生课程价格")} onClose={() => !busy && onClose()} footer={<>
          <Button variant="outline" disabled={busy} onClick={onClose}>{" " + uiT("取消") + " "}</Button>
          <Button disabled={busy || courses.isError || students.isError || courses.isPending || students.isPending} onClick={save}>
            {busy ? uiT("保存中…") : uiT("保存价格")}
          </Button>
        </>}>
      <div className="space-y-4 text-gray-900 dark:text-gray-100">
        <label className="block text-sm">{" " + uiT("教师") + " "}<select className={field} value={teacherId} disabled={busy} onChange={e => {
          onTeacher(e.target.value);
          setDraft(null);
          setError("");
        }}>
            {options.map(t => <option key={t.profile_id} value={t.profile_id}>
                {t.full_name}
              </option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">{" " + uiT("默认时薪") + " "}<input aria-label={uiT("默认时薪")} type="number" min="0" step="0.01" className={field} value={value.hourly_pay} onChange={e => change({
            hourly_pay: Number(e.target.value)
          })} />
          </label>
          <label className="text-sm">{" " + uiT("默认币种") + " "}<Currency value={value.currency} onChange={currency => change({
            currency
          })} />
          </label>
          <label className="text-sm">{" " + uiT("结算周期") + " "}<select className={field} value={value.cycle} onChange={e => change({
            cycle: e.target.value
          })}>
              <option value="weekly">{uiT("每周")}</option>
              <option value="monthly">{uiT("每月")}</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">{" " + uiT("默认价从今天起生效。规则优先级：学生＋课程 → 学生 → 课程 → 默认价。同级采用最近生效的规则。保存前会锁定历史完课金额和币种。学生约定价只用于统计，不自动收款或修改购课账单。") + " "}</p>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{uiT("单独计价规则")}</h3>
          <Button variant="outline" onClick={() => change({
          rules: [...value.rules, {
            course_id: null,
            student_id: null,
            hourly_pay: value.hourly_pay,
            currency: value.currency,
            student_price: null,
            effective_from: today(),
            active: true
          }]
        })}>{" " + uiT("新增规则") + " "}</Button>
        </div>
        {value.rules.map((r, i) => <div key={r.id || i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">{" " + uiT("课程") + " "}<select className={field} value={r.course_id || ""} onChange={e => update(i, {
              course_id: e.target.value || null,
              effective_from: today()
            })}>
                  <option value="">{uiT("所有课程")}</option>
                  {courseOptions.map(c => <option key={c.id} value={c.id}>
                      {c.name}
                    </option>)}
                </select>
              </label>
              <label className="text-sm">{" " + uiT("学生") + " "}<select className={field} value={r.student_id || ""} onChange={e => update(i, {
              student_id: e.target.value || null,
              effective_from: today()
            })}>
                  <option value="">{uiT("所有学生")}</option>
                  {studentOptions.map(s => <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>)}
                </select>
              </label>
              <label className="text-sm">{" " + uiT("教师时薪") + " "}<input type="number" min="0" step="0.01" className={field} value={r.hourly_pay} onChange={e => update(i, {
              hourly_pay: Number(e.target.value),
              effective_from: today()
            })} />
              </label>
              <label className="text-sm">{" " + uiT("课酬币种") + " "}<Currency value={r.currency} onChange={currency => update(i, {
              currency,
              effective_from: today()
            })} />
              </label>
              <label className="text-sm">{" " + uiT("学生收费 ¥/小时") + " "}<input type="number" min="0" step="0.01" placeholder={uiT("未约定")} className={field} value={r.student_price ?? ""} onChange={e => update(i, {
              student_price: e.target.value === "" ? null : Number(e.target.value),
              effective_from: today()
            })} />
              </label>
              <label className="text-sm">{" " + uiT("生效日期") + " "}<input type="date" className={field} value={r.effective_from} onChange={e => update(i, {
              effective_from: e.target.value
            })} />
              </label>
            </div>
            <label className="text-sm">
              <input type="checkbox" checked={r.active} onChange={e => update(i, {
            active: e.target.checked,
            effective_from: today()
          })} />{" "}{" " + uiT("启用此规则") + " "}</label>
            <Button size="sm" variant="outline" onClick={() => change({
          rules: value.rules.filter((_, j) => j !== i)
        })}>{" " + uiT("移除规则") + " "}</Button>
          </div>)}
        {error && <p role="alert" className="text-danger-600 dark:text-danger-400">
            {error}
          </p>}
        {(courses.isError || students.isError) && <p role="alert">{uiT("课程或学生读取失败，请关闭后重试。")}</p>}
      </div>
    </Dialog>;
}
function Currency({
  value,
  onChange
}) {
  useUiLanguage();
  return <select aria-label={uiT("币种")} className={field} value={value} onChange={e => onChange(e.target.value)}>
      {["PHP", "USD", "CNY", "EUR", "GBP", "CAD", "AUD"].map(v => <option key={v} value={v}>
          {v}
        </option>)}
    </select>;
}
