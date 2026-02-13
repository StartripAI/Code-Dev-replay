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
  const tokenize = (event: TimelineEvent): string[] =>
    `${event.label} ${event.detail}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4);

  const eventText = (event: TimelineEvent): string =>
    `${event.label} ${event.detail} ${event.tags.join(" ")}`.toLowerCase();

  const matchesRuleSeed = (rule: EventRule, text: string): boolean => {
    const anyMatch = rule.anyOf.some((token) => text.includes(token.toLowerCase()));
    if (!anyMatch) return false;
    if (rule.allOf?.length && !rule.allOf.every((token) => text.includes(token.toLowerCase()))) {
      return false;
    }
    if (rule.not?.length && rule.not.some((token) => text.includes(token.toLowerCase()))) {
      return false;
    }
    return true;
  };

  const ruleBags = new Map<string, Map<string, number>>();
  for (const rule of DEFAULT_RULES) {
    ruleBags.set(rule.id, new Map<string, number>());
  }

  for (const event of timeline) {
    const text = eventText(event);
    const words = tokenize(event);
    if (words.length === 0) continue;

    for (const rule of DEFAULT_RULES) {
      if (!matchesRuleSeed(rule, text)) continue;
      const bag = ruleBags.get(rule.id);
      if (!bag) continue;
      for (const word of words) {
        bag.set(word, (bag.get(word) ?? 0) + 1);
      }
    }
  }

  let boostedAny = false;
  const boosted: EventRule[] = DEFAULT_RULES.map((rule) => {
    const bag = ruleBags.get(rule.id);
    if (!bag || bag.size === 0) return rule;

    const top = [...bag.entries()]
      .filter(([word, count]) => count >= 2 && !rule.anyOf.some((token) => token.toLowerCase() === word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, Math.floor(topKeywords / DEFAULT_RULES.length)))
      .map(([word]) => word);

    if (top.length === 0) return rule;
    boostedAny = true;
    return {
      ...rule,
      anyOf: [...new Set([...rule.anyOf, ...top])],
    };
  });

  return boostedAny ? boosted : DEFAULT_RULES;
}
