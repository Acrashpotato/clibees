export type ManagerUserMessageIntent =
  | "progress_query"
  | "replan_request"
  | "other";

const REPLAN_INTENT_MARKERS = [
  "redo",
  "rework",
  "start over",
  "another style",
  "new style",
  "change requirement",
  "new requirement",
  "queue",
  "delegate",
  "new task",
  "重做",
  "重来",
  "重新做",
  "重新生成",
  "换一版",
  "换个风格",
  "改需求",
  "新增需求",
  "继续做",
  "重排",
];

const PROGRESS_INTENT_MARKERS = [
  "progress",
  "status",
  "update",
  "how is",
  "how far",
  "why no reply",
  "任务情况",
  "进展",
  "进度",
  "状态",
  "如何了",
  "到哪了",
  "为什么不回复",
  "还没回",
  "还在吗",
];

export function classifyManagerUserMessageIntent(
  body: string,
): ManagerUserMessageIntent {
  const compact = body.trim().toLowerCase();
  if (!compact) {
    return "other";
  }
  const normalized = compact.replace(/\s+/g, " ");

  if (REPLAN_INTENT_MARKERS.some((marker) => normalized.includes(marker))) {
    return "replan_request";
  }
  if (PROGRESS_INTENT_MARKERS.some((marker) => normalized.includes(marker))) {
    return "progress_query";
  }
  return "other";
}
