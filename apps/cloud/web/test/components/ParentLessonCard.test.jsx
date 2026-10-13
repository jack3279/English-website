import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ParentLessonCard from "../../src/features/parent-h5/ParentLessonCard.jsx";

afterEach(cleanup);

test("课程日期非法时不显示 Invalid Date，并保留时间待定提示", () => {
  render(
    <ParentLessonCard
      lesson={{
        id: "l1",
        scheduled_at: "not-a-date",
        duration_min: 60,
        courses: { name: "口语课" },
        profiles: { full_name: "Anna" },
      }}
      onLeave={() => {}}
    />,
  );

  expect(screen.getByText("待定")).toBeInTheDocument();
  expect(screen.getByText("时间待定")).toBeInTheDocument();
  expect(screen.getByText(/Anna/)).toHaveTextContent("Anna · 60 分钟");
  expect(document.body).not.toHaveTextContent("Invalid Date");
});
