import { useState } from "react";
import {
  Sparkles,
  Phone,
  User,
  Check,
  MessageCircle,
  Clock,
  BookOpen,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Card } from "../../components/ui/card.jsx";
import { BrandMark } from "../../components/BrandMark.jsx";
import { useToast } from "../../components/ui/toast.jsx";

const EMPTY_FORM = {
  parent_name: "",
  parent_phone: "",
  child_name: "",
  child_age: "",
  preferred_time: "",
  intended_course: "",
  trial_date: "",
  notes: "",
};

// 与后端 leads 表的 intended_course 保持一致。教务回电前就知道该推什么课。
const COURSE_OPTIONS = [
  "少儿口语",
  "自然拼读",
  "剑桥备考 (Starters/Movers)",
  "校内同步提分",
  "分级阅读",
  "还不确定, 想听建议",
];

// 期望试听日期从明天开始 —— 当天报名当天试听排不进课表, 给了只会让教务为难。
function minTrialDate() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

// 中国大陆 11 位手机号 (1[3-9] 开头)
const PHONE_RE = /^1[3-9]\d{9}$/;

function validate(form) {
  if (!form.parent_name.trim()) return "请填写家长称呼";
  if (!PHONE_RE.test(form.parent_phone.trim())) return "请填写有效的 11 位手机号";
  if (form.child_age && (Number(form.child_age) < 2 || Number(form.child_age) > 18))
    return "孩子年龄需在 2-18 之间";
  // 后端也会拦, 这里提前拦是为了不给家长一次无谓的网络往返
  if (form.trial_date && form.trial_date < minTrialDate()) return "期望试听日期需从明天起";
  return null;
}

const benefits = [
  { icon: User, title: "纯外教 1v1", desc: "100% 北美/英美认证老师, 全英文沉浸" },
  { icon: Clock, title: "灵活约课", desc: "每天 7-23 点, 提前 30 分钟取消免费" },
  { icon: BookOpen, title: "CEFR 体系", desc: "Pre-A1 到 B2 阶梯, 跟学校课标对齐" },
  { icon: MessageCircle, title: "课后反馈", desc: "每节课都有外教点评 + 学员录音" },
];

const stats = [
  { label: "认证外教", value: "120+" },
  { label: "在读学员", value: "500+" },
  { label: "完课节数", value: "8,000+" },
];

export default function RecruitPage() {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) {
    setForm({ ...form, [k]: v });
  }
  function reset() {
    setForm(EMPTY_FORM);
    setDone(false);
  }

  async function submit(e) {
    e.preventDefault();
    const msg = validate(form);
    if (msg) {
      setErr(msg);
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const body = { ...form, child_age: form.child_age ? Number(form.child_age) : null };
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "/api"}/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "提交失败");
      setDone(true);
      toast.success("报名提交成功, 我们会尽快联系您");
    } catch (e) {
      setErr(e.message || "提交失败");
      toast.error(e.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-accent-50 flex items-center justify-center p-6">
        <Card className="p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-success-100 flex items-center justify-center mb-4 dark:bg-success-900/40 ">
            <Check className="w-8 h-8 text-success-600 dark:text-success-300 " />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">报名成功</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 mb-6 leading-relaxed">
            我们已收到您的报名信息, 教务老师会在 24 小时内电话联系您安排免费试听课。
          </p>
          {(form.intended_course || form.trial_date) && (
            <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 rounded-lg px-4 py-3 mb-6 space-y-1">
              {form.intended_course && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 dark:text-gray-400">
                    意向课程：
                  </span>
                  {form.intended_course}
                </div>
              )}
              {form.trial_date && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 dark:text-gray-400">
                    期望试听：
                  </span>
                  {form.trial_date}
                  <span className="text-gray-500 dark:text-gray-400 text-xs">
                    （以教务回电确认为准）
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <Button variant="outline" className="w-full" onClick={reset}>
              再报一位
            </Button>
            <a
              href="/"
              className="block text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 hover:text-primary-700 dark:hover:text-primary-300 "
            >
              返回首页
            </a>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-canvas min-h-screen">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-gray-800 dark:bg-gray-950/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <BrandMark subtitle="英语外教管理" />
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="hidden text-sm text-gray-600 hover:text-primary-700 sm:inline dark:text-gray-400 dark:hover:text-primary-300 "
            >
              首页
            </a>
            <a href="/login">
              <Button variant="outline" size="sm">
                老师登录
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 grid md:grid-cols-2 gap-12 items-center">
        {/* Left: pitch */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-medium mb-5 dark:bg-primary-900/40 dark:text-primary-300 ">
            <Sparkles className="w-3.5 h-3.5" />
            限时 0 元试听
          </div>
          <h1 className="mb-4 text-3xl font-semibold leading-tight tracking-tight text-gray-900 dark:text-gray-100 md:text-5xl">
            让孩子和外教
            <br />
            <span className="bg-gradient-to-r from-primary-500 to-primary-700 bg-clip-text text-transparent">
              真正「说」起来
            </span>
          </h1>
          <p className="text-base text-gray-600 dark:text-gray-400 dark:text-gray-400 mb-8 leading-relaxed">
            17say.org 专注 4-14 岁少儿英语, 1v1 真人外教, 课后有反馈、家长看得见。
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl bg-white p-3 text-center shadow-card ring-1 ring-slate-900/[0.05] dark:bg-gray-900 dark:ring-white/[0.06]"
              >
                <div className="text-xl font-semibold tracking-tight text-primary-700 dark:text-primary-300 ">
                  {s.value}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-0.5">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 mb-8">
            {benefits.map((b) => (
              <div key={b.title} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center flex-shrink-0 dark:bg-primary-950/40 dark:text-primary-300 ">
                  <b.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {b.title}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-0.5">
                    {b.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-6 border-t border-gray-200 flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:border-gray-800 ">
            <span className="inline-flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-primary-700 dark:text-primary-300 " />
              咨询电话:{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">400-000-0000</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-primary-700 dark:text-primary-300 " />
              信息保密
            </span>
          </div>
        </div>

        {/* Right: form */}
        <Card className="p-6 md:p-8 shadow-modal border-0 ring-1 ring-gray-200/50">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-primary-700 dark:text-primary-300 " />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">免费预约试听</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400 mb-6">
            填好信息, 24 小时内回电 · 完全免费
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="parent_name">家长称呼 *</Label>
              <Input
                id="parent_name"
                required
                value={form.parent_name}
                onChange={(e) => set("parent_name", e.target.value)}
                placeholder="例: 张妈妈"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent_phone">手机号 *</Label>
              <Input
                id="parent_phone"
                required
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={form.parent_phone}
                onChange={(e) => set("parent_phone", e.target.value.replace(/\D/g, ""))}
                placeholder="11 位手机号, 以 1 开头"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="child_name">孩子姓名</Label>
                <Input
                  id="child_name"
                  value={form.child_name}
                  onChange={(e) => set("child_name", e.target.value)}
                  placeholder="例: 小明"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="child_age">年龄</Label>
                <Input
                  id="child_age"
                  type="number"
                  min="2"
                  max="18"
                  value={form.child_age}
                  onChange={(e) => set("child_age", e.target.value)}
                  placeholder="岁"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="intended_course">意向课程</Label>
                <Select
                  id="intended_course"
                  value={form.intended_course}
                  onChange={(e) => set("intended_course", e.target.value)}
                >
                  <option value="">请选择</option>
                  {COURSE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trial_date">期望试听日期</Label>
                <Input
                  id="trial_date"
                  type="date"
                  min={minTrialDate()}
                  value={form.trial_date}
                  onChange={(e) => set("trial_date", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preferred_time">方便联系时间</Label>
              <Select
                id="preferred_time"
                value={form.preferred_time}
                onChange={(e) => set("preferred_time", e.target.value)}
              >
                <option value="">随时</option>
                <option value="工作日上午">工作日上午</option>
                <option value="工作日下午">工作日下午</option>
                <option value="工作日晚上">工作日晚上</option>
                <option value="周末全天">周末全天</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">其他说明</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="孩子的英语基础 / 想达成的目标..."
                rows={3}
              />
            </div>

            {err && (
              <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:text-danger-300 dark:bg-danger-900/25 dark:border-danger-800 ">
                {err}
              </div>
            )}

            <Button type="submit" disabled={submitting} size="lg" className="w-full mt-2">
              {submitting ? "提交中..." : "立即预约 0 元试听"}
              {!submitting && <ArrowRight className="w-4 h-4 ml-1" />}
            </Button>

            <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-1">
              提交即同意我们联系您 · 信息仅用于约课, 不会泄露
            </p>
          </form>
        </Card>
      </main>

      <footer className="text-center text-xs text-gray-500 dark:text-gray-400 py-8">
        © 2026 17say.org · 英语外教培训管理系统 · v2.0
      </footer>
    </div>
  );
}
