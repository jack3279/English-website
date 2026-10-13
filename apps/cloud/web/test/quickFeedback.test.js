import { test, expect } from "vitest";
import { BASIC_RECEIPT, composeQuickFeedback } from "../src/lib/quickFeedback.js";
test("全部留空也能保存真实上课确认，不默认填表现或作业", () => {
  expect(composeQuickFeedback({})).toEqual({
    content: BASIC_RECEIPT,
    performance: "",
    homework: "",
    next_plan: "",
    publishToParent: true,
  });
});
test("只有老师实际选择的标签进入反馈，备注合并，草稿不自动发布", () => {
  expect(
    composeQuickFeedback({
      topics: ["阅读练习"],
      performance: ["需继续练习"],
      content: " P10 ",
      publish: false,
    }),
  ).toEqual({
    content: "阅读练习；P10",
    performance: "需继续练习",
    homework: "",
    next_plan: "",
    publishToParent: false,
  });
});
