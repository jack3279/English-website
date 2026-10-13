// 手机端课表列表的行为约定。
//
// 为什么要有这个组件：*WeekGrid 是 repeat(N, minmax(72px,1fr)) 的横向网格，
// 窄屏扣掉时间列后列宽被压到读不出字。本测试锁住替代方案的关键行为，
// 防止有人后来把它改回网格 / 改回按数量截断。
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import MobileScheduleList from "../../src/features/schedule/MobileScheduleList.jsx";

afterEach(cleanup);

function at(h, m = 0, day = 9) {
  // 本地时间构造，避免 UTC 偏移让「上午/下午」分组跑到别的时段
  const d = new Date(2026, 9, day, h, m, 0, 0);
  return d.toISOString();
}

function lesson(overrides = {}) {
  return {
    id: "l1",
    student_id: "s1",
    teacher_id: "t1",
    scheduled_at: at(10, 0),
    duration_min: 60,
    status: "scheduled",
    read: false,
    ...overrides,
  };
}

test("按上午/下午/晚上分组，不因固定高度丢课节", () => {
  // 一天 5 节课，如果组件是固定高度容器 + 截断，这里只能看到前几条
  render(
    <MobileScheduleList
      lessons={[
        lesson({ id: "a", scheduled_at: at(9, 0) }),
        lesson({ id: "b", scheduled_at: at(10, 30) }),
        lesson({ id: "c", scheduled_at: at(13, 0) }),
        lesson({ id: "d", scheduled_at: at(15, 0) }),
        lesson({ id: "e", scheduled_at: at(19, 0) }),
      ]}
      students={[{ id: "s1", full_name: "陈小美" }]}
      teachers={[{ id: "t1", full_name: "Lily" }]}
    />,
  );
  expect(screen.getByText("上午")).toBeInTheDocument();
  expect(screen.getByText("下午")).toBeInTheDocument();
  expect(screen.getByText("晚上")).toBeInTheDocument();
  // 5 条都要渲染出来 —— 这正是网格做不到的
  expect(screen.getAllByText(/10:00|09:00|10:30|13:00|15:00|19:00/).length).toBeGreaterThanOrEqual(5);
});

test("家长端隐藏学员行（hideStudent）", () => {
  render(
    <MobileScheduleList
      lessons={[lesson({ student_id: "s1" })]}
      students={[{ id: "s1", full_name: "陈小美" }]}
      teachers={[{ id: "t1", full_name: "Lily" }]}
      hideStudent
    />,
  );
  expect(screen.queryByText("陈小美")).not.toBeInTheDocument();
  expect(screen.getByText("Lily")).toBeInTheDocument();
});

test("teacher_id 用 profile_id 匹配（ lessons 存的是 profile_id）", () => {
  // teachers.id 与 profile_id 不同是本项目的既有坑：传错会匹配不到、显示「—」
  render(
    <MobileScheduleList
      lessons={[lesson({ teacher_id: "prof-9" })]}
      teachers={[{ id: 7, profile_id: "prof-9", full_name: "John" }]}
      hideStudent
    />,
  );
  expect(screen.getByText("John")).toBeInTheDocument();
  expect(screen.queryByText("未分配")).not.toBeInTheDocument();
});

test("点课节触发回调", () => {
  const onClick = vi.fn();
  render(
    <MobileScheduleList
      lessons={[lesson({ id: "x" })]}
      students={[{ id: "s1", full_name: "陈小美" }]}
      teachers={[{ id: "t1", full_name: "Lily" }]}
      onLessonClick={onClick}
    />,
  );
  fireEvent.click(screen.getByText(/10:00/));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onClick.mock.calls[0][0].id).toBe("x");
});

test("空数据给空态而不是空白", () => {
  render(<MobileScheduleList lessons={[]} students={[]} teachers={[]} />);
  expect(screen.getByText(/所选日期无课节|本周暂无课节/)).toBeInTheDocument();
});