import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import HourLedger from "./HourLedger.jsx";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cake, Package, Plus, Minus, FileText, GraduationCap, AlertTriangle, Calendar, Sliders, Receipt, Undo2 } from "lucide-react";
import { useStudent } from "./useStudent.js";
import { StudentStatusBadge } from "./studentStatus.jsx";
import { StudentReport } from "./StudentReport.jsx";
import FeedList from "../parent-h5/FeedList.jsx";
import PurchasePackageDialog from "./PurchasePackageDialog.jsx";
import RefundPackageDialog from "./RefundPackageDialog.jsx";
import { useAuth } from "../auth/useAuth.js";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import FamilyPanel from "./FamilyPanel.jsx";
import { useInstitution } from "../admin/InstitutionContext.jsx";
import { financialRequest } from "../../lib/financialRequest.js";
function avatarColor(name) {
  const tones = ["bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ", "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ", "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ", "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ", "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 ", "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 "];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = hash * 31 + name.charCodeAt(i) & 0xffff;
  return tones[hash % tones.length];
}
const REASON_LABEL = () => ({
  topup: uiT("购买课时"),
  consume: uiT("上课消耗"),
  adjust: uiT("人工调整"),
  refund: uiT("退费")
});
export default function StudentDetailPage() {
  useUiLanguage();
  const {
    id
  } = useParams();
  const {
    user
  } = useAuth();
  const isAdmin = user?.role === "admin";
  const {
    rules
  } = useInstitution();
  const canViewPayments = user?.role === "admin" || user?.role === "parent";
  const qc = useQueryClient();
  const {
    data: student,
    isLoading,
    error
  } = useStudent(id);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const toast = useToast();

  // 缴费记录。学员详情接口只带课时包，不含缴费；而"这学期收了多少钱"是对账时最先要看的。
  const {
    data: payments = []
  } = useQuery({
    queryKey: ["student-payments", id],
    queryFn: async () => (await http(`/packages/payments/${id}`)).data ?? [],
    enabled: !!id && canViewPayments
  });
  const purchaseMut = useMutation({
    mutationFn: async body => (await financialRequest("/packages/purchase", body)).data,
    onSuccess: d => {
      qc.invalidateQueries({
        queryKey: ["student", id]
      });
      qc.invalidateQueries({
        queryKey: ["student-hour-ledger", id]
      });
      qc.invalidateQueries({
        queryKey: ["student-payments", id]
      });
      qc.invalidateQueries({
        queryKey: ["students"]
      });
      qc.invalidateQueries({
        queryKey: ["alerts"]
      });
      qc.invalidateQueries({
        queryKey: ["finance"]
      });
      setBuyOpen(false);
      toast.success(uiT("已开卡 +{0}h，缴费已记录", [d?.student_package?.total_hours ?? 0]));
    },
    onError: e => toast.error(e?.message || uiT("购买失败"))
  });
  const refundMut = useMutation({
    mutationFn: async body => (await financialRequest("/packages/refund", body)).data,
    onSuccess: d => {
      qc.invalidateQueries({
        queryKey: ["student", id]
      });
      qc.invalidateQueries({
        queryKey: ["student-hour-ledger", id]
      });
      qc.invalidateQueries({
        queryKey: ["student-payments", id]
      });
      qc.invalidateQueries({
        queryKey: ["students"]
      });
      qc.invalidateQueries({
        queryKey: ["alerts"]
      });
      qc.invalidateQueries({
        queryKey: ["finance"]
      });
      setRefundOpen(false);
      const money = Number(d?.amount_cents || 0) / 100;
      toast.success(money > 0 ? uiT("已退 {0}h，退款 ¥{1}", [d?.refunded_hours ?? 0, money.toFixed(2)]) : uiT("已退 {0}h", [d?.refunded_hours ?? 0]));
    },
    onError: e => toast.error(e?.message || uiT("退费失败"))
  });
  const adjustMut = useMutation({
    mutationFn: async body => http(`/students/${id}/adjust-hours`, {
      method: "POST",
      body
    }),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({
        queryKey: ["student", id]
      });
      qc.invalidateQueries({
        queryKey: ["student-hour-ledger", id]
      });
      qc.invalidateQueries({
        queryKey: ["students"]
      });
      qc.invalidateQueries({
        queryKey: ["alerts"]
      });
      setAdjustOpen(false);
      const sign = body.delta >= 0 ? "+" : "";
      toast.success(uiT("已调整 {0}{1}h", [sign, body.delta]));
    },
    onError: e => toast.error(e?.message || uiT("调整失败"))
  });
  return <div className="min-h-full">
      <PageHeader back={user?.role === "parent" ? "/parent" : "/students"} backLabel={user?.role === "parent" ? uiT("孩子课程") : uiT("学员列表")} title={student?.full_name || uiT("学员详情")} icon={GraduationCap} />

      <main className="page-body space-y-4">
        {isLoading && <LoadingCard />}
        {error && <Card className="p-4 bg-danger-50 border-danger-200 text-danger-700 text-sm dark:bg-danger-900/25 dark:border-danger-800 dark:text-danger-300 ">{" " + uiT("加载失败:") + " "}{error.message}
          </Card>}

        {student && <>
            {/* 学员卡片 */}
            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-full text-2xl font-semibold flex items-center justify-center ${avatarColor(student.full_name)}`}>
                  {student.full_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {student.full_name}
                    </h2>
                    <StudentStatusBadge status={student.status} />
                    {student.status === "active" && (student.remaining_hours ?? 0) < 3 && <Badge variant="destructive">
                        <AlertTriangle className="w-3 h-3 mr-0.5" />{" " + uiT("低余额") + " "}</Badge>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                    {student.birth_date && <span className="inline-flex items-center gap-1">
                        <Cake className="w-3 h-3" />
                        {student.birth_date}
                      </span>}
                  </div>
                </div>
              </div>
            </Card>

            {isAdmin && <FamilyPanel studentId={id} />}
            {/* 剩余课时 + 备注 */}
            <div className="grid sm:grid-cols-2 gap-4">
              <Card className="p-5">
                <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400 mb-1">{" " + uiT("剩余课时") + " "}</div>
                <div className={`text-3xl font-semibold tabular-nums tracking-tight ${(student.remaining_hours ?? 0) === 0 ? "text-danger-600 dark:text-danger-300 " : (student.remaining_hours ?? 0) < rules.lowBalanceHours ? "text-warning-600 dark:text-warning-300 " : "text-success-600 dark:text-success-300 "}`}>
                  {student.remaining_hours ?? 0}
                  <span className="text-lg font-normal text-gray-500 dark:text-gray-400 dark:text-gray-400 ml-1">
                    h
                  </span>
                </div>
                {student.notes && <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 italic dark:border-gray-800 ">
                    {`"${student.notes}"`}
                  </div>}
              </Card>
              <Card className="p-5">
                <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400 mb-1 flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" />{" " + uiT("课时包") + " "}</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {(student.packages ?? []).length}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400 dark:text-gray-400 ml-1">{" " + uiT("个") + " "}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1">{" " + uiT("累计")}{" "}
                  {(student.packages ?? []).reduce((s, p) => s + (p.total_hours || 0), 0).toFixed(1)}{" "}
                  h
                </div>
                {/* 收钱是这里最主要的动作 —— 之前后端有 /packages/purchase（开卡 + 缴费
                    原子化）但前端没有入口，教务收了费根本录不进系统。 */}
                {isAdmin && <Button size="sm" className="mt-3 w-full" onClick={() => setBuyOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />{" " + uiT("购买课时包 / 录缴费") + " "}</Button>}
                {user?.role === "admin" && <Button size="sm" variant="outline" className="mt-1.5 w-full" onClick={() => setRefundOpen(true)}>
                    <Undo2 className="w-3.5 h-3.5 mr-1" />{" " + uiT("办理退费") + " "}</Button>}
                {isAdmin && <Button size="sm" variant="ghost" className="mt-1.5 w-full text-gray-500 dark:text-gray-400" onClick={() => setAdjustOpen(true)}>
                    <Sliders className="w-3.5 h-3.5 mr-1" />{" " + uiT("手动调整课时") + " "}</Button>}
              </Card>
            </div>

            {user?.role === "parent" && <section aria-label={uiT("已发布课堂反馈")} className="space-y-3">
                <h2 className="font-semibold">{uiT("已发布课堂反馈")}</h2>
                <FeedList studentId={id} />
              </section>}
            {/* 课时包明细 + 缴费记录 */}
            <div className="grid lg:grid-cols-2 gap-4">
              <section>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Package className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{" " + uiT("课时包明细") + " "}</h2>
                </div>
                <Card className="overflow-hidden p-0">
                  {(student.packages ?? []).length === 0 ? <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">{" " + uiT("还没有课时包") + " "}<div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {isAdmin ? uiT("点上方「购买课时包 / 录缴费」开第一个") : uiT("请联系教务核对课时包")}
                      </div>
                    </div> : <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {(student.packages ?? []).map(p => {
                  const left = Number(p.remaining_hours ?? 0);
                  const total = Number(p.total_hours ?? 0);
                  const pct = total > 0 ? Math.max(0, Math.min(100, left / total * 100)) : 0;
                  const exp = p.expires_at ? new Date(p.expires_at) : null;
                  const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;
                  return <li key={p.id} className="px-5 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {p.package_types?.name || uiT("课时包")}
                              </div>
                              <div className="text-sm tabular-nums">
                                <span className={left === 0 ? "text-danger-600 dark:text-danger-400 font-semibold" : "text-gray-900 dark:text-gray-100 font-semibold"}>
                                  {left}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {" "}
                                  / {total}h
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                              <div className={`h-full rounded-full ${left === 0 ? "bg-danger-600" : pct < 20 ? "bg-warning-500" : "bg-success-500"}`} style={{
                        width: `${pct}%`
                      }} />
                            </div>
                            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                              <span>{" " + uiT("购于")}{" "}
                                {p.purchased_at ? new Date(p.purchased_at).toLocaleDateString(uiLocale(), {
                          timeZone: "Asia/Shanghai"
                        }) : "—"}
                              </span>
                              {exp ? <span className={daysLeft !== null && daysLeft <= 30 ? "text-warning-600 dark:text-warning-400" : ""}>{" " + uiT("到期")}{" "}
                                  {exp.toLocaleDateString(uiLocale(), {
                          timeZone: "Asia/Shanghai"
                        })}
                                  {daysLeft !== null && daysLeft >= 0 ? uiT("（{0} 天）", [daysLeft]) : uiT("（已过期）")}
                                </span> : <span className="text-gray-500 dark:text-gray-400">{uiT("不限期")}</span>}
                            </div>
                            {p.notes && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic">
                                {p.notes}
                              </div>}
                          </li>;
                })}
                    </ul>}
                </Card>
              </section>

              {canViewPayments && <section>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Receipt className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{" " + uiT("缴费记录") + " "}</h2>
                    {payments.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{" " + uiT("累计 ¥") + " "}{(payments.reduce((s, p) => s + Number(p.amount_cents || 0), 0) / 100).toFixed(2)}
                      </span>}
                  </div>
                  <Card className="overflow-hidden p-0">
                    {payments.length === 0 ? <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">{" " + uiT("还没有缴费记录") + " "}</div> : <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {payments.map(pay => {
                  const cents = Number(pay.amount_cents || 0);
                  const refunded = cents < 0;
                  return <li key={pay.id} className="px-5 py-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className={`text-sm ${refunded ? "text-danger-600 dark:text-danger-300 " : "text-gray-900 dark:text-gray-100"}`}>
                                  {refunded ? uiT("退费 ") : ""}¥{(Math.abs(cents) / 100).toFixed(2)}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  {new Date(pay.paid_at).toLocaleString(uiLocale(), {
                          timeZone: "Asia/Shanghai",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false
                        })}
                                  {pay.method ? ` · ${pay.method}` : ""}
                                  {pay.notes ? ` · ${pay.notes}` : ""}
                                </div>
                              </div>
                            </li>;
                })}
                      </ul>}
                  </Card>
                </section>}
            </div>

            {canViewPayments ? <HourLedger studentId={id} studentName={student.full_name} /> : <>
                {/* 课时流水 */}
                <section>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400 dark:text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{" " + uiT("课时流水 (最近 50 条)") + " "}</h2>
                  </div>
                  <Card className="overflow-hidden p-0">
                    {(student.transactions ?? []).length === 0 ? <div className="p-8 text-center">
                        <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400">{" " + uiT("无流水") + " "}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{" " + uiT("购买课时或上课消耗后会自动记录") + " "}</div>
                      </div> : <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {(student.transactions ?? []).map(t => {
                  const pos = Number(t.delta) > 0;
                  return <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${pos ? "bg-success-100 text-success-600 dark:bg-success-900/40 dark:text-success-300 " : "bg-danger-100 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300 "}`}>
                                {pos ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-gray-900 dark:text-gray-100">
                                  {REASON_LABEL()[t.reason] || t.reason || uiT("其他")}
                                </div>
                                {t.note && <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-0.5 truncate">
                                    {t.note}
                                  </div>}
                              </div>
                              <div className="text-right">
                                <div className={`text-sm font-bold ${pos ? "text-success-600 dark:text-success-300 " : "text-danger-600 dark:text-danger-300 "}`}>
                                  {pos ? "+" : ""}
                                  {t.delta} h
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(t.created_at).toLocaleDateString(uiLocale(), {
                          timeZone: "Asia/Shanghai"
                        })}
                                </div>
                              </div>
                            </li>;
                })}
                      </ul>}
                  </Card>
                </section>
              </>}

            {/* 学习报告 */}
            <StudentReport studentId={id} feedbackHref={user?.role === "parent" ? "/parent" : undefined} />
          </>}
      </main>

      {adjustOpen && student && <AdjustHoursDialog student={student} onClose={() => setAdjustOpen(false)} submitting={adjustMut.isPending} err={adjustMut.error} onSubmit={body => adjustMut.mutate(body)} />}

      {refundOpen && student && <RefundPackageDialog student={student} onClose={() => setRefundOpen(false)} submitting={refundMut.isPending} err={refundMut.error} onSubmit={body => refundMut.mutate(body)} />}

      {buyOpen && student && <PurchasePackageDialog student={student} onClose={() => setBuyOpen(false)} submitting={purchaseMut.isPending} err={purchaseMut.error} onSubmit={body => purchaseMut.mutate(body)} />}
    </div>;
}
function AdjustHoursDialog({
  student,
  onClose,
  onSubmit,
  submitting,
  err
}) {
  useUiLanguage();
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  const sign = Number(delta) >= 0 ? "+" : "";
  const newBalance = (student.remaining_hours ?? 0) + Number(delta || 0);
  return <Dialog open onClose={onClose} title={uiT("手动调整课时")} description={uiT("{0} 当前剩余 {1}h", [student.full_name, student.remaining_hours ?? 0])} footer={<>
          <Button variant="outline" onClick={onClose}>{" " + uiT("取消") + " "}</Button>
          <Button disabled={submitting || !delta || !reason.trim() || Number.isNaN(Number(delta))} onClick={() => onSubmit({
      delta: Number(delta),
      reason: reason.trim()
    })}>
            {submitting ? uiT("提交中...") : uiT("确认调整")}
          </Button>
        </>}>
      <div className="space-y-4">
        <div className="bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-md p-3 text-sm text-warning-700 dark:text-warning-300">
          <Sliders className="w-4 h-4 inline mr-1" />{" " + uiT("手动调整会被记录到课时流水和审计日志, 学员/家长端会看到。") + " "}</div>
        <div className="space-y-1.5">
          <Label htmlFor="adj-delta">{uiT("调整量 (小时) *")}</Label>
          <Input id="adj-delta" type="number" step="0.5" value={delta} onChange={e => setDelta(e.target.value)} placeholder={uiT("正数加, 负数扣")} required />
          <div className="text-xs text-gray-500 dark:text-gray-400">{" " + uiT("调整后余额:")}{" "}
            <span className={`font-semibold ${newBalance < 0 ? "text-danger-600 dark:text-danger-400" : "text-success-600 dark:text-success-400"}`}>
              {sign}
              {delta || 0}h → {newBalance}h
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adj-reason">{uiT("调整原因 *")}</Label>
          <Input id="adj-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder={uiT("例: 生日赠送 / 系统误扣补回 / 退款冲销")} required />
        </div>
        {err && <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
            {err.message}
          </div>}
      </div>
    </Dialog>;
}
