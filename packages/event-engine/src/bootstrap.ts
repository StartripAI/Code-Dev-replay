import type { EventRule, TimelineEvent } from "../../shared-types/src";
import { DEFAULT_RULES } from "./defaultRules";

export interface BootstrapRulesOptions {
  topKeywords?: number;
}

export function bootstrapRulesFromTimeline(
  timeline: TimelineEvent[],
  options: BootstrapRulesOptions = {},
): EventRule[] {
  const topKeywords = options.topKeywords ?? 16;
  const bag = new Map<string, number>();

  for (const event of timeline) {
    const words = `${event.label} ${event.detail}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);

    for (const word of words) {
      bag.set(word, (bag.get(word) ?? 0) + 1);
    }
  }

  const top = [...bag.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topKeywords)
    .map(([word]) => word);

  if (top.length === 0) {
    return DEFAULT_RULES;
  }

  const boosted: EventRule[] = DEFAULT_RULES.map((rule) => ({
    ...rule,
    anyOf: [...new Set([...rule.anyOf, ...top.slice(0, 3)])],
  }));

  return boosted;
}
