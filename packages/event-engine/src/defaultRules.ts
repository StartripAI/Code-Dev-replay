import type { EventRule } from "../../shared-types/src";

export const DEFAULT_RULES: EventRule[] = [
  {
    id: "goal-delivery",
    eventType: "GOAL",
    anyOf: ["fixed", "implemented", "merged", "shipped", "done", "success", "完成", "已实现", "搞定"],
    weight: 1.2,
    minScore: 1,
  },
  {
    id: "assist-tool",
    eventType: "ASSIST",
    anyOf: ["tool", "shell", "apply_patch", "function_call", "query", "tool_use", "tool_result"],
    weight: 1,
    minScore: 1,
  },
  {
    id: "penalty-failure",
    eventType: "PENALTY",
    anyOf: ["error", "failed", "exception", "timeout", "cannot", "失败", "报错", "超时"],
    weight: 1.1,
    minScore: 1,
  },
  {
    id: "yellow-warning",
    eventType: "YELLOW_CARD",
    anyOf: ["warning", "deprecated", "risk", "caution", "warning:", "注意", "风险"],
    weight: 0.9,
    minScore: 1,
  },
  {
    id: "red-blocker",
    eventType: "RED_CARD",
    anyOf: ["blocked", "fatal", "security", "permission denied", "blocked by", "权限", "阻塞"],
    weight: 1.4,
    minScore: 1,
  },
  {
    id: "corner-setup",
    eventType: "CORNER",
    anyOf: ["plan", "scaffold", "initialize", "setup", "skeleton", "规划", "计划", "初始化"],
    weight: 0.8,
    minScore: 1,
  },
  {
    id: "offside-revert",
    eventType: "OFFSIDE",
    anyOf: ["revert", "rollback", "wrong", "mistake", "撤销", "回滚", "误判"],
    weight: 1,
    minScore: 1,
  },
  {
    id: "substitution-switch",
    eventType: "SUBSTITUTION",
    anyOf: ["switch", "replace", "migrate", "refactor", "替换", "切换", "迁移"],
    weight: 0.8,
    minScore: 1,
  },
];
