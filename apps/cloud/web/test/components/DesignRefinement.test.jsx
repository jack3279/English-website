import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ParentLessonCard from "../../src/features/parent-h5/ParentLessonCard.jsx";
import FeedList from "../../src/features/parent-h5/FeedList.jsx";
import AdminQuickSearch from "../../src/features/admin/AdminQuickSearch.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function mount(component) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{component}</QueryClientProvider>
    </MemoryRouter>,
  );
}
test("家长课程按北京时间显示起止，缺失或不安全地址不出现上课链接", () => {
  const lesson = {
    id: "l1",
    scheduled_at: "2026-10-09T08:00:00Z",
    duration_min: 90,
    courses: { name: "绘本", meeting_url: "javascript:alert(1)" },
  };
  const leave = vi.fn();
  const { rerender } = render(<ParentLessonCard lesson={lesson} onLeave={leave} />);
  expect(screen.getByText("16:00–17:30")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "进入教室" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "请假" }));
  expect(leave).toHaveBeenCalledWith(lesson);
  rerender(
    <ParentLessonCard
      lesson={{
        ...lesson,
        courses: { name: "绘本", meeting_url: "https://meeting.example.com/room" },
      }}
      onLeave={leave}
    />,
  );
  expect(screen.getByRole("link", { name: "进入教室" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
});
test("反馈详情保留老师布置的作业，并提供已有学校留言入口", async () => {
  http.mockResolvedValue({
    data: [
      {
        id: "f1",
        content: "自然拼读",
        performance: "积极参与",
        homework: "复习单词卡",
        next_plan: "阅读绘本",
        teacher_name: "Emma",
        scheduled_at: "2026-10-09T08:00:00Z",
      },
    ],
  });
  mount(<FeedList studentId="s1" />);
  fireEvent.click(await screen.findByRole("button", { name: /查看上课记录/ }));
  expect(screen.getByRole("dialog", { name: "上课记录" })).toBeInTheDocument();
  expect(screen.getByText("复习单词卡")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "给学校留言" })).toHaveAttribute(
    "href",
    "/parent/messages",
  );
});
test("反馈读取失败显示重试而不是空反馈", async () => {
  http.mockRejectedValue(new Error("offline"));
  mount(<FeedList studentId="s1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("上课记录加载失败");
  expect(screen.queryByText("还没有课堂反馈")).not.toBeInTheDocument();
});
test("管理员快捷查找使用实际档案并保留教师关键词导航", async () => {
  http.mockImplementation(async (path) => ({
    data:
      path === "/teachers"
        ? [{ id: "t1", full_name: "Emma", specialties: ["reading"] }]
        : [{ id: "s1", full_name: "Lily", remaining_hours: 19 }],
  }));
  mount(<AdminQuickSearch />);
  fireEvent.click(screen.getByRole("button", { name: "快速查找学员与教师" }));
  fireEvent.change(screen.getByRole("textbox", { name: "快速搜索" }), {
    target: { value: "Emma" },
  });
  expect(await screen.findByRole("link", { name: /Lily/ })).toHaveAttribute("href", "/students/s1");
  expect(screen.getByRole("link", { name: /Emma/ })).toHaveAttribute(
    "href",
    "/admin/teachers?search=Emma",
  );
});
