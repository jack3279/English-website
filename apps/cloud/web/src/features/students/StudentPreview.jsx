import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Link } from "react-router-dom";
import { useStudent } from "./useStudent.js";
import { studentStatusLabel } from "./studentStatus.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
export default function StudentPreview({
  id
}) {
  useUiLanguage();
  const {
    data: student,
    isLoading,
    error,
    refetch
  } = useStudent(id);
  return <aside className="student-preview">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">{uiT("学员预览")}</h2>
        {!id ? <p className="text-sm text-gray-500 dark:text-gray-400 ">{" " + uiT("点击列表中的“预览”，快速查看课时和档案。") + " "}</p> : isLoading ? <p>{uiT("正在加载学员…")}</p> : error ? <div role="alert">{" " + uiT("学员资料加载失败") + " "}<Button variant="outline" onClick={() => refetch()}>{" " + uiT("重试") + " "}</Button>
          </div> : student && <>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-lg font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ">
                  {student.full_name?.charAt(0)}
                </span>
                <div>
                  <h3 className="font-semibold">{student.full_name}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 ">
                    {studentStatusLabel(student.status)}{" "}
                    {student.birth_date && `· ${student.birth_date}`}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-primary-50 p-3 dark:bg-primary-950">
                  <strong className="text-2xl text-primary-700 dark:text-primary-200">
                    {student.remaining_hours ?? 0}
                  </strong>
                  <p className="text-xs text-gray-500 dark:text-gray-400 ">{uiT("剩余小时")}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                  <strong className="text-2xl">{student.packages?.length ?? 0}</strong>
                  <p className="text-xs text-gray-500 dark:text-gray-400 ">{uiT("课时包")}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {(student.packages || []).map(p => <div key={p.id} className="rounded-lg border border-gray-100 p-3 text-xs dark:border-gray-800">
                    <strong>{p.package_types?.name || uiT("课时包")}</strong>
                    <p className="mt-1 text-gray-500 dark:text-gray-400 ">{" " + uiT("包内余量") + " "}{p.remaining_hours} / {p.total_hours}{" " + uiT("小时") + " "}</p>
                    <p className="mt-1 text-gray-500 dark:text-gray-400 ">{" " + uiT("实际可用课时以上方余额为准") + " "}</p>
                  </div>)}
              </div>
              {student.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-gray-500 dark:text-gray-400 ">
                  {student.notes}
                </p>}
              <Link className="mt-5 block rounded-lg bg-primary-600 p-3 text-center text-sm font-medium text-white" to={`/students/${student.id}`}>{" " + uiT("查看完整档案") + " "}</Link>
            </>}
      </Card>
    </aside>;
}
