import { useState } from "react";
import { Upload, FileDown, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { parseSheetToRows, downloadTemplate } from "../../lib/xlsx.js";

const ENTITIES = [
  { id: "students", label: "学员", hint: "姓名必填; 级别/学情/家长信息会并入备注" },
  { id: "teachers", label: "老师", hint: "姓名必填; 新老师自动创建登录账号（占位邮箱）" },
  { id: "packages", label: "课时包", hint: "学员姓名+课时包名称必填; 新包类型自动创建" },
  {
    id: "payments",
    label: "缴费记录",
    hint: "学员姓名+金额必填; 仅支持「已付」, 按 学员+包+日期+金额 去重",
  },
];

const TEMPLATE_HEADERS = {
  students: ["姓名", "出生日期", "状态", "英语级别", "学情分析", "家长姓名", "家长电话", "备注"],
  teachers: ["姓名", "邮箱", "时薪", "擅长方向", "国籍", "电话", "状态"],
  packages: [
    "学员姓名",
    "课时包名称",
    "总课时",
    "已用课时",
    "单价",
    "开始日期",
    "到期日",
    "状态",
    "备注",
  ],
  payments: ["学员姓名", "课时包名称", "日期", "金额", "方式", "状态", "备注"],
};

export default function DataImportPage() {
  const toast = useToast();
  const [entity, setEntity] = useState("students");
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setPreview(null);
    setBusy(true);
    try {
      const parsed = await parseSheetToRows(file);
      // 去掉全空行
      const cleaned = parsed.filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!cleaned.length) {
        setErr("文件里没有可导入的数据行");
        setRows(null);
        setFileName("");
        return;
      }
      if (cleaned.length > 200) {
        setErr(`一次最多导入 200 行（当前 ${cleaned.length} 行），请拆分文件`);
        setRows(null);
        setFileName("");
        return;
      }
      setRows(cleaned);
      setFileName(file.name);
      await dryrun(cleaned);
    } catch (e2) {
      setErr(e2?.message || "文件解析失败");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function dryrun(nextRows) {
    const r = await http("/admin/import-rows", {
      method: "POST",
      body: { entity, rows: nextRows, dryrun: true },
    });
    setPreview(r.data);
  }

  async function commit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await http("/admin/import-rows", {
        method: "POST",
        body: { entity, rows, dryrun: false },
      });
      setPreview(r.data);
      if (r.data?.errors?.length) {
        toast.error(`导入完成，但有 ${r.data.errors.length} 行有问题`);
      } else {
        toast.success(`导入完成：新增 ${r.data.created}，更新 ${r.data.updated}`);
      }
    } catch (e) {
      setErr(e?.message || "导入失败");
    } finally {
      setBusy(false);
    }
  }

  const current = ENTITIES.find((x) => x.id === entity);

  return (
    <div className="min-h-full">
      <PageHeader
        icon={FileSpreadsheet}
        title="历史数据导入"
        subtitle="从 Excel 批量导入学员 / 老师 / 课时包 / 缴费记录"
      />

      <main className="page-body space-y-4">
        <Card className="p-4">
          <Segmented
            value={entity}
            onChange={(id) => {
              setEntity(id);
              setRows(null);
              setPreview(null);
              setErr(null);
              setFileName("");
            }}
            items={ENTITIES.map((it) => ({ key: it.id, label: it.label }))}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{current?.hint}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadTemplate(`导入模板_${current?.label}.xlsx`, TEMPLATE_HEADERS[entity])
              }
            >
              <FileDown className="w-3.5 h-3.5 mr-1" />
              下载 {current?.label} 模板
            </Button>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 cursor-pointer hover:border-primary-400 transition">
            <Upload className="w-6 h-6 text-gray-500 dark:text-gray-400 " />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {busy
                ? "解析中…"
                : fileName
                  ? `已选择：${fileName}（点击可重新选择）`
                  : "点击选择 .xlsx / .csv 文件"}
            </span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>

          {err && (
            <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
              {err}
            </div>
          )}

          {preview && !preview.dryrun && (
            <div className="flex items-center gap-2 text-sm text-success-700 dark:text-success-300">
              <CheckCircle2 className="w-4 h-4" />
              已导入：新增 {preview.created} · 更新 {preview.updated} · 跳过 {preview.skipped}
            </div>
          )}

          {preview?.dryrun && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <Badge variant="success">将新增 {preview.created}</Badge>
                <Badge variant="default">将更新 {preview.updated}</Badge>
                <Badge variant="secondary">跳过 {preview.skipped}</Badge>
              </div>
              {preview.errors?.length > 0 && (
                <div className="text-sm bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded p-3 space-y-0.5">
                  <div className="flex items-center gap-1 font-medium text-warning-700 dark:text-warning-300">
                    <AlertTriangle className="w-4 h-4" />
                    {preview.errors.length} 行有问题（正式导入时会跳过这些行）
                  </div>
                  <ul className="list-disc pl-5 text-warning-700 dark:text-warning-300 max-h-40 overflow-y-auto">
                    {preview.errors.map((e2, i) => (
                      <li key={i}>{e2}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button onClick={commit} disabled={busy || !rows?.length}>
                {busy ? "导入中…" : "确认导入"}
              </Button>
            </div>
          )}
        </Card>

        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <div>· 建议顺序：学员 → 老师 → 课时包 → 缴费记录（后者按名称引用前者）。</div>
          <div>· 重复导入安全：已存在的数据只会补空字段，不会覆盖已有内容；缴费按自然键去重。</div>
        </div>
      </main>
    </div>
  );
}
