import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState } from "react";
import { Megaphone, BookOpen, Pin, Trash2, ExternalLink, FileText, Link2 } from "lucide-react";
import { useAuth } from "../auth/useAuth.js";
import { useMyStudents } from "../leave/useLeave.js";
import { Card } from "../../components/ui/card.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { PageShell } from "../../components/PageShell.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement, useMaterials, useCreateMaterial, useDeleteMaterial } from "./useContent.js";
const KIND_ICON = {
  file: FileText,
  link: Link2,
  text: FileText
};
const KIND_LABEL = () => ({
  file: uiT("文件"),
  link: uiT("链接"),
  text: uiT("文本")
});
const AUDIENCE_LABEL = () => ({
  admin: uiT("仅管理员"),
  teacher: uiT("仅老师"),
  parent: uiT("仅家长")
});
function fmt(dt) {
  if (!dt) return "";
  return new Date(dt).toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

// /content 对老师与家长都是只读视图: 公告与教材统一由管理员发布
function ReadOnlyHint({
  children
}) {
  useUiLanguage();
  return <div className="rounded-lg bg-gray-50 dark:bg-gray-900/60 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
      {children}
    </div>;
}
function Tabs({
  value,
  onChange
}) {
  useUiLanguage();
  const items = [{
    key: "ann",
    label: uiT("公告"),
    icon: Megaphone
  }, {
    key: "mat",
    label: uiT("学习内容"),
    icon: BookOpen
  }];
  return <Segmented value={value} onChange={onChange} items={items} />;
}
function AnnouncementPanel({
  role
}) {
  useUiLanguage();
  const {
    data,
    isLoading
  } = useAnnouncements();
  const create = useCreateAnnouncement();
  const remove = useDeleteAnnouncement();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [audience, setAudience] = useState("");
  const [pinned, setPinned] = useState(false);
  const items = data?.items ?? [];
  async function submit(e) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        title: title.trim(),
        body: bodyText.trim(),
        audience: audience || null,
        pinned
      });
      toast.success(uiT("公告已发布"));
      setTitle("");
      setBodyText("");
      setPinned(false);
      setOpen(false);
    } catch (err) {
      toast.error(err?.message || uiT("发布失败"));
    }
  }
  return <div className="space-y-3">
      {role === "admin" ? <div className="flex justify-end">
          <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen(v => !v)}>
            <Megaphone className="w-3.5 h-3.5 mr-1" />
            {open ? uiT("收起") : uiT("发布公告")}
          </Button>
        </div> : <ReadOnlyHint>{uiT("公告由机构统一发布，当前为只读视图")}</ReadOnlyHint>}

      {open && <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ann-title">{uiT("标题 *")}</Label>
                <Input id="ann-title" value={title} onChange={e => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-audience">{uiT("可见范围")}</Label>
                <Select id="ann-audience" value={audience} onChange={e => setAudience(e.target.value)}>
                  <option value="">{uiT("全员")}</option>
                  <option value="teacher">{uiT("仅老师")}</option>
                  <option value="parent">{uiT("仅家长")}</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-body">{uiT("正文 *")}</Label>
              <Textarea id="ann-body" rows={3} value={bodyText} onChange={e => setBodyText(e.target.value)} required />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />{" " + uiT("置顶") + " "}</label>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? uiT("发布中…") : uiT("发布")}
            </Button>
          </form>
        </Card>}

      {isLoading ? <Loading /> : items.length === 0 ? <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">{uiT("暂无公告")}</Card> : <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map(a => <li key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.pinned && <Pin className="w-3.5 h-3.5 text-primary-700 dark:text-primary-300 " />}
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {a.title}
                      </span>
                      <Badge variant="secondary">{AUDIENCE_LABEL()[a.audience] ?? uiT("全员")}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {a.body}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {fmt(a.published_at)}
                    </div>
                  </div>
                  {role === "admin" && <Button size="icon" variant="ghost" aria-label={uiT("删除公告")} onClick={async () => {
              try {
                await remove.mutateAsync(a.id);
                toast.success(uiT("已删除"));
              } catch (err) {
                toast.error(err?.message || uiT("删除失败"));
              }
            }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>}
                </div>
              </li>)}
          </ul>
        </Card>}
    </div>;
}
function MaterialPanel({
  role
}) {
  useUiLanguage();
  const {
    data: students = []
  } = useMyStudents();
  const [studentId, setStudentId] = useState("");
  const {
    data,
    isLoading
  } = useMaterials({
    studentId
  });
  const create = useCreateMaterial();
  const remove = useDeleteMaterial();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [kind, setKind] = useState("link");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [target, setTarget] = useState("");
  const items = data?.items ?? [];
  const canEdit = role === "admin";
  async function submit(e) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: desc.trim() || null,
        kind,
        url: kind === "link" ? url.trim() : kind === "file" ? url.trim() || null : null,
        storage_path: kind === "file" && !url.trim() ? null : null,
        content: kind === "text" ? content : null,
        student_id: target || null
      });
      toast.success(uiT("已发布"));
      setTitle("");
      setDesc("");
      setUrl("");
      setContent("");
      setOpen(false);
    } catch (err) {
      toast.error(err?.message || uiT("发布失败"));
    }
  }
  return <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="mat-student" className="text-xs text-gray-500 dark:text-gray-400">{" " + uiT("筛选学员") + " "}</Label>
          <Select id="mat-student" className="h-8 w-44" value={studentId} onChange={e => setStudentId(e.target.value)}>
            <option value="">{uiT("全部")}</option>
            {students.map(s => <option key={s.id} value={s.id}>
                {s.full_name}
              </option>)}
          </Select>
        </div>
        {canEdit && <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen(v => !v)}>
            <BookOpen className="w-3.5 h-3.5 mr-1" />
            {open ? uiT("收起") : uiT("发布内容")}
          </Button>}
      </div>

      {!canEdit && <ReadOnlyHint>{uiT("学习内容由机构统一发布，当前为只读视图")}</ReadOnlyHint>}

      {open && <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mat-title">{uiT("标题 *")}</Label>
                <Input id="mat-title" value={title} onChange={e => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mat-kind">{uiT("类型")}</Label>
                <Select id="mat-kind" value={kind} onChange={e => setKind(e.target.value)}>
                  <option value="link">{uiT("链接")}</option>
                  <option value="file">{uiT("文件 (R2 / Storage)")}</option>
                  <option value="text">{uiT("文本")}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mat-target">{uiT("发给学员")}</Label>
                <Select id="mat-target" value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="">{uiT("通用教材")}</option>
                  {students.map(s => <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>)}
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-desc">{uiT("说明")}</Label>
              <Input id="mat-desc" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            {kind === "text" ? <div className="space-y-1.5">
                <Label htmlFor="mat-content">{uiT("正文 *")}</Label>
                <Textarea id="mat-content" rows={3} value={content} onChange={e => setContent(e.target.value)} required />
              </div> : <div className="space-y-1.5">
                <Label htmlFor="mat-url">{kind === "file" ? uiT("文件 URL *") : uiT("链接 *")}</Label>
                <Input id="mat-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." required />
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{" " + uiT("文件请上传到 R2 后贴 URL, 不要放 Supabase Storage (免费档出网只有 5 GB/月)。") + " "}</div>
              </div>}
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? uiT("发布中…") : uiT("发布")}
            </Button>
          </form>
        </Card>}

      {isLoading ? <Loading /> : items.length === 0 ? <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">{" " + uiT("暂无学习内容") + " "}</Card> : <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map(m => {
          const Icon = KIND_ICON[m.kind] ?? FileText;
          return <li key={m.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="w-4 h-4 text-gray-500 shrink-0 dark:text-gray-400 " />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {m.title}
                      </span>
                      <Badge variant="secondary">{KIND_LABEL()[m.kind] ?? m.kind}</Badge>
                      <Badge variant={m.student_id ? "default" : "outline"}>
                        {m.student_id ? m.student_name || uiT("指定学员") : uiT("通用")}
                      </Badge>
                    </div>
                    {m.description && <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {m.description}
                      </div>}
                    {m.kind === "text" && m.content && <div className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {m.content}
                      </div>}
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {fmt(m.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline dark:text-primary-300 ">{" " + uiT("打开") + " "}<ExternalLink className="w-3 h-3" />
                      </a>}
                    {canEdit && <Button size="icon" variant="ghost" aria-label={uiT("删除教材")} onClick={async () => {
                try {
                  await remove.mutateAsync(m.id);
                  toast.success(uiT("已删除"));
                } catch (err) {
                  toast.error(err?.message || uiT("删除失败"));
                }
              }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>}
                  </div>
                </li>;
        })}
          </ul>
        </Card>}
    </div>;
}
export default function ContentPage() {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const role = user?.role || "parent";
  const [tab, setTab] = useState("ann");
  const home = role === "teacher" ? "/teacher/today" : role === "parent" ? "/parent" : "/admin";
  return <PageShell back={home} backLabel={role === "teacher" ? uiT("今日") : role === "parent" ? uiT("首页") : uiT("总览")} icon={Megaphone} title={uiT("公告与教材")} subtitle={uiT("公告按角色可见，学习内容可面向全员或指定学员")} contentClassName="space-y-4">
      <Tabs value={tab} onChange={setTab} />
      {tab === "ann" ? <AnnouncementPanel role={role} /> : <MaterialPanel role={role} />}
    </PageShell>;
}
