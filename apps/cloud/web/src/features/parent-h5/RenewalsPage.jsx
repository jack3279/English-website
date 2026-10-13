import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth.js";
import { http } from "../../lib/http.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Button } from "../../components/ui/button.jsx";
const states = {
  pending: "待付款／待补充凭证",
  review: "待确认到账",
  processing: "入账处理中，请联系管理员",
  confirmed: "已到账，课时已增加",
  cancelled: "已取消",
};
const money = (n) => `¥${(n / 100).toFixed(2)}`;
const field =
  "w-full rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-gray-900";
async function readImage(file) {
  if (!file) return "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 500000)
    throw new Error("请选择不超过 500KB 的 PNG、JPEG 或 WebP 图片");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
export default function RenewalsPage() {
  const { user } = useAuth(),
    admin = user?.role === "admin",
    qc = useQueryClient();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(null),
    [config, setConfig] = useState(null),
    [student, setStudent] = useState(""),
    [proof, setProof] = useState(""),
    [note, setNote] = useState(""),
    [password, setPassword] = useState(""),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState("");
  const settings = useQuery({
    queryKey: ["renewal-config"],
    queryFn: async () => (await http("/renewals/config")).data,
  });
  const orders = useQuery({
    queryKey: ["renewal-orders"],
    queryFn: async () => (await http("/renewals")).data,
    refetchInterval: 60000,
  });
  const catalog = useQuery({
    queryKey: ["renewal-catalog"],
    queryFn: async () => (await http("/renewals/catalog")).data,
    enabled: !admin,
  });
  const students = useQuery({
    queryKey: ["renewal-students"],
    queryFn: async () => (await http("/students?pageSize=100")).data,
    enabled: !admin,
  });
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["renewal-orders"] });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id) {
    await run(async () => {
      setSelected((await http(`/renewals/${id}`)).data);
      setProof("");
      setNote("");
      setPassword("");
      setAmount("");
      setReference("");
      setReason("");
    });
  }
  async function action(type, body) {
    await run(async () => {
      setSelected((await http(`/renewals/${selected.id}/${type}`, { method: "POST", body })).data);
      setPassword("");
    });
  }
  const cfg = config ||
    settings.data || {
      enabled: false,
      recipient: "",
      qr: "",
      instructions: "付款时请备注学生姓名和订单编号。",
    };
  return (
    <div>
      <PageHeader
        title={admin ? "续费订单与收款设置" : "自助续费"}
        subtitle="个人微信收款 · 管理员确认到账后增加课时"
      />
      <main className="mx-auto max-w-4xl space-y-5 p-4 text-gray-900 dark:text-gray-100">
        {(error || settings.error || orders.error || catalog.error || students.error) && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-950 dark:text-red-200"
          >
            {error ||
              settings.error?.message ||
              orders.error?.message ||
              catalog.error?.message ||
              students.error?.message}
          </p>
        )}
        {admin ? (
          <details className="rounded-xl border p-4 dark:border-gray-700">
            <summary className="cursor-pointer font-semibold">收款码与续费设置</summary>
            <div className="mt-4 space-y-3">
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setConfig({ ...cfg, enabled: e.target.checked })}
                />
                开放家长自助续费
              </label>
              <label className="block">
                微信收款人姓名
                <input
                  className={field}
                  value={cfg.recipient}
                  onChange={(e) => setConfig({ ...cfg, recipient: e.target.value })}
                />
              </label>
              <label className="block">
                上传个人微信收款码（PNG/JPEG/WebP，500KB 以内）
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) =>
                    run(async () => setConfig({ ...cfg, qr: await readImage(e.target.files[0]) }))
                  }
                />
              </label>
              {cfg.qr && (
                <img src={cfg.qr} alt="收款码预览" className="h-48 w-48 object-contain bg-white" />
              )}
              <label className="block">
                付款说明
                <textarea
                  className={field}
                  value={cfg.instructions}
                  onChange={(e) => setConfig({ ...cfg, instructions: e.target.value })}
                />
              </label>
              <p className="text-sm text-gray-500">
                家长只能选购已启用且价格大于零的课时包。请在课时包管理中维护售价；订单提交后价格不再变化。
              </p>
              <Button
                disabled={busy || !cfg.qr || !cfg.recipient}
                onClick={() =>
                  run(async () => {
                    await http("/renewals/config", { method: "POST", body: cfg });
                    await qc.invalidateQueries({ queryKey: ["renewal-config"] });
                    setConfig(null);
                  })
                }
              >
                保存收款设置
              </Button>
            </div>
          </details>
        ) : settings.data?.enabled ? (
          <section className="space-y-3">
            <label>
              选择学生
              <select
                className={field}
                value={student}
                onChange={(e) => setStudent(e.target.value)}
              >
                <option value="">请选择</option>
                {(students.data || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(catalog.data || []).map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                >
                  <h2 className="font-semibold">{p.name}</h2>
                  <p className="my-3">
                    {p.hours} 课时 · {money(p.price_cents)}
                  </p>
                  <Button
                    disabled={busy || !student}
                    onClick={() =>
                      run(async () =>
                        setSelected(
                          (
                            await http("/renewals", {
                              method: "POST",
                              body: {
                                id: crypto.randomUUID(),
                                student_id: student,
                                package_type_id: p.id,
                              },
                            })
                          ).data,
                        ),
                      )
                    }
                  >
                    选择并生成订单
                  </Button>
                </div>
              ))}
            </div>
            {catalog.data?.length === 0 && <p>暂无可购买的课时包，请联系管理员。</p>}
          </section>
        ) : (
          <p>自助续费暂未开放，请联系管理员。</p>
        )}
        {selected && (
          <section className="space-y-3 rounded-xl border p-4 dark:border-gray-700">
            <div className="flex justify-between">
              <h2 className="font-semibold">
                {selected.student_name} · {selected.package_name}
              </h2>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                关闭
              </Button>
            </div>
            <p>
              {selected.hours} 课时 · 应付 {money(selected.amount_cents)}
            </p>
            <p className="break-all text-xs text-gray-500">订单编号：{selected.id}</p>
            <p>{states[selected.status]}</p>
            {selected.review_note && (
              <p className="text-amber-700 dark:text-amber-300">退回说明：{selected.review_note}</p>
            )}
            {!admin && ["pending", "review"].includes(selected.status) && (
              <>
                <p>收款人：{selected.recipient}</p>
                <img
                  src={selected.qr}
                  alt="个人微信收款二维码"
                  className="h-56 w-56 max-w-full bg-white object-contain"
                />
                <p>{selected.instructions}</p>
                <a href={selected.qr} download="微信收款码.png" className="inline-block text-primary-700 underline dark:text-primary-300">保存收款码图片</a>
                <p className="text-sm">
                  扫码后请核对收款人，并手动填写 {money(selected.amount_cents)}
                  。手机上可保存图片后，在微信扫一扫中从相册选择。提交凭证后等待确认到账。
                </p>
                <label className="block">
                  付款凭证
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => run(async () => setProof(await readImage(e.target.files[0])))}
                  />
                </label>
                {proof && <img src={proof} alt="付款凭证预览" className="max-h-56 max-w-full" />}
                <label>
                  付款备注
                  <input
                    className={field}
                    maxLength={150}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <Button disabled={busy || !proof} onClick={() => action("proof", { proof, note })}>
                  提交付款凭证
                </Button>
                {selected.status === "pending" && (
                  <Button variant="outline" disabled={busy} onClick={() => action("cancel", {})}>
                    取消未付款订单
                  </Button>
                )}
              </>
            )}
            {admin && ["review", "processing"].includes(selected.status) && (
              <>
                <p>家长付款备注：{selected.note || "无"}</p>
                {selected.proof && (
                  <a href={selected.proof} target="_blank" rel="noreferrer">
                    <img
                      src={selected.proof}
                      alt="家长付款凭证，点击放大"
                      className="max-h-80 max-w-full"
                    />
                  </a>
                )}
                <p className="text-sm">
                  请先打开你的微信核对真实到账。截图不能代替收款记录；确认后系统将增加课时并登记学费。
                </p>
                <label>
                  实际到账金额（元）
                  <input
                    className={field}
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="block">
                  微信交易单号
                  <input
                    className={field}
                    maxLength={80}
                    value={selected.payment_reference || reference}
                    disabled={!!selected.payment_reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  <span className="text-xs text-gray-500">
                    在微信账单中打开这笔收款查看，不能重复用于其他订单。
                  </span>
                </label>
                <label>
                  当前管理员密码
                  <input
                    className={field}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <Button
                  disabled={
                    busy ||
                    !password ||
                    !(selected.payment_reference || reference).trim() ||
                    Math.round(Number(amount) * 100) !== selected.amount_cents
                  }
                  onClick={() =>
                    action("confirm", {
                      current_password: password,
                      amount_cents: Math.round(Number(amount) * 100),
                      payment_reference: selected.payment_reference || reference,
                    })
                  }
                >
                  {selected.status === "processing" ? "恢复完成入账" : "确认已到账并增加课时"}
                </Button>
                {selected.status === "review" && (
                  <>
                    <label>
                      退回原因
                      <input
                        className={field}
                        maxLength={150}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      disabled={busy || !reason.trim()}
                      onClick={() => action("reject", { reason })}
                    >
                      退回补充凭证
                    </Button>
                  </>
                )}
              </>
            )}
          </section>
        )}
        <section>
          <h2 className="mb-3 font-semibold">{admin ? "全部续费订单" : "我的续费订单"}</h2>
          {orders.isPending ? (
            <p>加载中…</p>
          ) : !orders.data?.length ? (
            <p className="text-gray-500">暂无续费订单</p>
          ) : (
            <div className="space-y-2">
              {orders.data.map((o) => (
                <button
                  key={o.id}
                  disabled={busy}
                  onClick={() => open(o.id)}
                  className="w-full rounded-xl border bg-white p-4 text-left dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>
                      {o.student_name} · {o.package_name}
                    </span>
                    <strong>{money(o.amount_cents)}</strong>
                  </div>
                  <p className="mt-2 text-sm">
                    {states[o.status]} · {o.hours} 课时
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
