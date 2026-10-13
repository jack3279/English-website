export const BASIC_RECEIPT = "本节课程已完成。此为上课确认，未填写详细学习反馈。";
export const LEARNING_OPTIONS = [
  "口语练习",
  "听力练习",
  "阅读练习",
  "自然拼读",
  "词汇学习",
  "复习巩固",
];
export const PERFORMANCE_OPTIONS = ["参与积极", "能跟上课堂", "需要鼓励", "需继续练习"];
export function composeQuickFeedback({
  topics = [],
  content = "",
  performance = [],
  homework = "",
  nextPlan = "",
  publish = true,
}) {
  return {
    content:
      [topics.length ? topics.join("、") : "", content.trim()].filter(Boolean).join("；") ||
      BASIC_RECEIPT,
    performance: performance.join("、"),
    homework: homework.trim(),
    next_plan: nextPlan.trim(),
    publishToParent: publish,
  };
}
