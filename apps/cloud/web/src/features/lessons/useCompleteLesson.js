import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";
import { uiT } from '../../i18n/store.js';

export function useCompleteLesson() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ lessonId, payload }) => {
      return (await http(`/lessons/${lessonId}/${payload.result ? "roll-call" : "complete"}`, { method: "POST", body: payload })).data;
    },
    onSuccess: (_data, vars) => {
      if (_data?.classified_as_absent) toast.info(uiT('未在截止前请假，已登记为缺勤，结算待管理员确认。'));
      if (
        _data?.parentFeedPublished === false &&
        !_data?.alreadyCompleted &&
        vars.payload?.publishToParent !== false
      )
        toast.error("完课已记录，上课确认尚未发出。请从待办补发，不会重复扣课。");
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({queryKey:["lesson-detail"]});
      // 消课会改余额，而余额数据来自 ["student", id]（见 StudentDetailPage）
      if (vars.studentId) {
        qc.invalidateQueries({ queryKey: ["student", vars.studentId] });
        qc.invalidateQueries({ queryKey: ["student-payments", vars.studentId] });
      }
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student-hour-ledger"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      for (const key of [
        ["makeups"],
        ["operations"],
        ["parent-upcoming"],
        ["payroll"],
        ["teacher-home-payroll"],
        ["parent-feeds"],
      ])
        qc.invalidateQueries({ queryKey: key });
    },
    // 失败必须有反馈：否则页面毫无反应，用户会以为已经成功（余额却没扣）
    onError: (e) => toast.error(e?.message || "标记完成失败"),
  });
}
