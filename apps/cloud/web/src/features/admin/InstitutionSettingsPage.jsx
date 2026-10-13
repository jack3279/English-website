import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Save } from "lucide-react";
import { useInstitution, DEFAULT_INSTITUTION } from "./InstitutionContext.jsx";
import { http } from "../../lib/http.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { useToast } from "../../components/ui/toast.jsx";
function editable(rules) {
  return Object.fromEntries(
    Object.keys(DEFAULT_INSTITUTION).map((key) => [key, rules[key] ?? DEFAULT_INSTITUTION[key]]),
  );
}
function NumberField({ id, label, value, min, max, step = 1, onChange }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        required
        value={value}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
    </div>
  );
}
export default function InstitutionSettingsPage() {
  const { rules, loading, error, refresh } = useInstitution(),
    qc = useQueryClient(),
    toast = useToast();
  const [form, setForm] = useState(() => editable(rules)),
    [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!loading && !error && !initialized.current) {
      setForm(editable(rules));
      initialized.current = true;
    }
  }, [rules, loading, error]);
  function field(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await http("/institution-settings", { method: "PATCH", body: form });
      qc.setQueryData(["institution-settings"], response.data);
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["operations"] });
      qc.invalidateQueries({ queryKey: ["me", "renewal"] });
      toast.success("机构设置已保存，所有设备将同步新规则");
    } catch (failure) {
      toast.error(failure.message || "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-full">
      <PageHeader
        icon={Settings2}
        title="机构设置"
        subtitle="统一业务默认值与提醒规则，保留历史账单"
        actions={
          <Button
            type="submit"
            form="institution-form"
            disabled={busy || loading || !!error || rules.storageReady === false}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {busy ? "正在保存…" : "保存设置"}
          </Button>
        }
      />
      <main className="page-body space-y-4 max-w-5xl">
        {loading ? (
          <Card className="p-5">正在读取机构设置…</Card>
        ) : error ? (
          <Card className="p-5">
            <p role="alert">机构设置加载失败。</p>
            <Button variant="outline" className="mt-3" onClick={() => refresh()}>
              重试
            </Button>
          </Card>
        ) : (
          <form id="institution-form" onSubmit={submit} className="space-y-4">
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">机构与课程</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="institution-name">机构显示名称</Label>
                  <Input
                    id="institution-name"
                    value={form.institutionName}
                    onChange={(event) => field("institutionName", event.target.value)}
                    required
                    maxLength={50}
                  />
                </div>
                <NumberField
                  id="institution-duration"
                  label="新课程默认时长（分钟）"
                  value={form.defaultDurationMin}
                  min={15}
                  max={240}
                  onChange={(value) => field("defaultDurationMin", value)}
                />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 ">
                时区：北京时间。课时按小时保存，60 分钟为 1
                小时；本页不会改变现有课程时长或重算历史费用。
              </p>
            </Card>
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">余额与续费提醒</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="institution-balance"
                  label="学员低余额阈值（小时）"
                  value={form.lowBalanceHours}
                  min={0.5}
                  max={100}
                  step={0.5}
                  onChange={(value) => field("lowBalanceHours", value)}
                />
                <NumberField
                  id="institution-expiry"
                  label="课时包到期提前提醒（天）"
                  value={form.expiryWarnDays}
                  min={0}
                  max={365}
                  onChange={(value) => field("expiryWarnDays", value)}
                />
                <NumberField
                  id="institution-renewal-percent"
                  label="课时包续费提醒比例（%）"
                  value={form.renewalPercent}
                  min={1}
                  max={100}
                  onChange={(value) => field("renewalPercent", value)}
                />
                <NumberField
                  id="institution-renewal-min"
                  label="课时包续费最低提醒阈值（小时）"
                  value={form.renewalMinHours}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(value) => field("renewalMinHours", value)}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 ">
                学员低余额按实际学员余额判断；课时包续费按该包余量和到期时间判断。续费阈值取最低小时数与包总量比例的较大值。
              </p>
            </Card>
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">请假规则</h2>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.absenceDeductHours}
                  onChange={(e) => field("absenceDeductHours", e.target.checked)}
                />
                <span>
                  缺勤扣学生课时
                  <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                    缺勤由管理员逐节确认。此设置仅作为结算确认时的预选值；关闭预选不扣课时，开启预选按课长扣课时。历史结果保留。
                  </span>
                </span>
              </label>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={form.absencePayTeacher??true} onChange={e=>field('absencePayTeacher',e.target.checked)}/><span>缺勤默认预选计教师课酬<span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">仅作管理员逐节确认时的预选值；管理员可独立选择支付或不支付，不自动结算。</span></span></label>


              <NumberField
                id="institution-leave"
                label="请假最晚提前（分钟）"
                value={form.leaveDeadlineHours === '' ? '' : Math.round(form.leaveDeadlineHours * 60)}
                min={0}
                max={10080}
                step={1}
                onChange={(value) => field("leaveDeadlineHours", value === '' ? '' : Math.round(value) / 60)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 ">
                默认 240 分钟（4 小时），可按 1 分钟调整。例如 19:00 上课，默认最晚 15:00 提交。0 表示最晚在上课开始前提交。截止前提交按请假审批；超时未上课按缺勤登记，由管理员逐节确认扣课时及教师课酬。新的申请保存提交时的规则，修改设置不改变已记录的规则。
              </p>
            </Card>
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">教师负荷提醒</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["dailyHours", "每日课时上限（小时）", 1, 24, 0.5],
                  ["weeklyHours", "每周课时上限（小时）", 1, 168, 0.5],
                  ["consecutiveLessons", "连续节数提醒", 2, 12, 1],
                  ["breakMinutes", "建议课间休息（分钟）", 1, 60, 1],
                ].map(([key, label, min, max, step]) => (
                  <NumberField
                    key={key}
                    id={`institution-${key}`}
                    label={label}
                    value={form.loadLimits[key]}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(value) =>
                      setForm((previous) => ({
                        ...previous,
                        loadLimits: { ...previous.loadLimits, [key]: value },
                      }))
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 ">
                阈值在课程表统一使用，用于提醒，不会自动取消或移动课程。
              </p>
            </Card>
            {rules.storageReady === false && (
              <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
                机构配置存储尚未准备好，暂不能保存。
              </p>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
