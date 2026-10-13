import LessonCompleteModal from "../../src/features/lessons/LessonCompleteModal.jsx";
import { BASIC_RECEIPT } from "../../src/lib/quickFeedback.js";
import LessonDetailModal from "../../src/features/schedule/LessonDetailModal.jsx";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AttendanceModal from "../../src/features/lessons/AttendanceModal.jsx";
import ParentMakeupRequestForm from "../../src/features/leave/ParentMakeupRequestForm.jsx";
import HourLedger from "../../src/features/students/HourLedger.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { id: "teacher", role: "teacher" } }),
}));
const state = vi.hoisted(() => ({ deduct: false }));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/features/admin/InstitutionContext.jsx", () => ({
  useInstitution: () => ({
    rules: { absenceDeductHours: state.deduct },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: () => ({
    data: [
      {
        id: "original",
        student_id: "student",
        students: { full_name: "孩子甲" },
        status: "cancelled",
        scheduled_at: "2026-10-01T01:00:00Z",
      },
    ],
    isPending: false,
    isError: false,
  }),
}));
let client;
const lesson = {
  id: "lesson",
  student_id: "student",
  duration_min: 90,
  scheduled_at: "2026-10-01T01:00:00Z",
};
function mount(component) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
  state.deduct = false;
});
test("教师缺勤仅登记，结算须等待管理员确认",async()=>{
 state.deduct=true;http.mockResolvedValue({data:{status:'no_show',review_status:'pending'}});
 mount(<AttendanceModal lesson={lesson} onClose={vi.fn()} onPresent={vi.fn()}/>);
 fireEvent.click(screen.getByText('缺勤'));
 expect(screen.queryByRole('checkbox',{name:/本次扣除学生课时/})).not.toBeInTheDocument();
 expect(screen.getByText(/缺勤登记后由管理员确认结算/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'确认缺席'}));
 await waitFor(()=>expect(http).toHaveBeenCalledWith('/lessons/lesson/attendance',expect.objectContaining({body:{result:'no_show',deduct_hours:false,reason:''}})));
});
test("教师无法选择支付或扣费",()=>{
 mount(<AttendanceModal lesson={lesson} onClose={vi.fn()} onPresent={vi.fn()}/>);fireEvent.click(screen.getByText('缺勤'));expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test("家长只提交原课节和希望时间，不直接设置补课老师或状态", async () => {
  http.mockResolvedValue({ data: { id: "makeup", status: "pending" } });
  mount(<ParentMakeupRequestForm />);
  fireEvent.click(screen.getByRole("button", { name: "申请补课" }));
  fireEvent.change(screen.getByLabelText("需要补课的课程"), { target: { value: "original" } });
  fireEvent.change(screen.getByLabelText("补课需求说明"), { target: { value: "希望周末上午" } });
  fireEvent.click(screen.getByRole("button", { name: "提交补课需求" }));
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith(
      "/makeups",
      expect.objectContaining({
        method: "POST",
        body: {
          original_lesson_id: "original",
          student_id: "student",
          scheduled_at: null,
          note: "希望周末上午",
        },
      }),
    ),
  );
  expect(await screen.findByText(/补课需求已提交/)).toBeInTheDocument();
});
test("课时账单显示缺席扣课与当前余额，可打开对应上课记录", async () => {
  http.mockImplementation(async (path) => ({
    data: path.includes("hour-ledger")
      ? {
          remaining_hours: 7.5,
          summary: {
            purchased_hours: 10,
            consumed_hours: 1.5,
            refunded_hours: 2,
            adjusted_hours: 1,
          },
          events: [
            {
              id: "tx",
              label: "缺席扣课时",
              delta: -1.5,
              at: "2026-10-01",
              note: "未提前请假",
              lesson_id: "lesson",
            },
          ],
        }
      : {
          status: "no_show",
          duration_min: 90,
          scheduled_at: "2026-10-01",
          record: null,
          published: false,
          attendance: {
            state: "done",
            result: { deducted_hours: 1.5 },
            choice: { reason: "未提前请假" },
          },
        },
  }));
  mount(<HourLedger studentId="student" />);
  expect(await screen.findByText("7.5 小时")).toBeInTheDocument();
  expect(screen.getByText(/缺席扣课时 · -1.5小时/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上课记录" }));
  expect(await screen.findByText(/缺席处理：扣除1.5小时/)).toBeInTheDocument();
  expect(screen.getByText("暂无已发布的课堂反馈。")).toBeInTheDocument();
});

test("课表到课操作先填写反馈，不能提交空内容直接扣课", async () => {
  http.mockResolvedValue({
    data: {
      ...lesson,
      teacher_id: "teacher",
      status: "scheduled",
      students: { full_name: "学生甲" },
    },
  });
  mount(<LessonDetailModal lessonId="lesson" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "点名" }));

  expect(http.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  fireEvent.change(screen.getByLabelText(/本节课上课内容/), { target: { value: "练习自然拼读" } });
  fireEvent.click(screen.getByRole("button", { name: "保存点名及上课记录" }));
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith(
      "/lessons/lesson/roll-call",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ content: "练习自然拼读" }),
      }),
    ),
  );
});

test("点名需要上课内容，不再包含课堂评价或作业", () => {
  const submit = vi.fn();
  mount(<LessonCompleteModal lesson={lesson} onClose={vi.fn()} onSubmit={submit} />);
  expect(screen.getByLabelText("本节课上课内容")).toBeRequired();
  expect(screen.getByRole("button", { name: "保存点名及上课记录" })).toBeDisabled();
  expect(screen.queryByText("课堂表现")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("本节课上课内容"), { target: { value: "Unit 1 page 2" } });
  fireEvent.click(screen.getByRole("button", { name: "保存点名及上课记录" }));
  expect(submit).toHaveBeenCalledWith({
    result: "attended",
    content: "Unit 1 page 2",
    reason: "",
    deduct_hours: false,
  });
});
test('新点名缺勤不执行扣课和课酬结算，交由管理员确认',()=>{state.deduct=true;const submit=vi.fn();mount(<LessonCompleteModal lesson={lesson} onClose={vi.fn()} onSubmit={submit}/>);fireEvent.click(screen.getByRole('button',{name:'缺勤',exact:true}));expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('本节课上课内容'),{target:{value:'Unit 1 planned'}});fireEvent.click(screen.getByRole('button',{name:'保存点名及上课记录'}));expect(submit).toHaveBeenCalledWith({result:'no_show',content:'Unit 1 planned',reason:'',deduct_hours:false});});
