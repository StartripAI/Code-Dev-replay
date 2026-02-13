import type { ClassifyOptions, EventRule, MajorEvent, TimelineEvent } from "../../shared-types/src";
import { stableId } from "../../core/src";
import { summarizeMajorEventWithLLM } from "../../llm-adapters/src";

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function scoreRule(rule: EventRule, event: TimelineEvent): number {
  const text = normalizeText(`${event.label} ${event.detail} ${event.tags.join(" ")}`);
  let score = 0;

  for (const token of rule.anyOf) {
    if (text.includes(token.toLowerCase())) {
      score += 1;
    }
  }

  if (rule.allOf?.length) {
    const allPresent = rule.allOf.every((token) => text.includes(token.toLowerCase()));
    if (!allPresent) return 0;
  }

  if (rule.not?.length) {
    const forbidden = rule.not.some((token) => text.includes(token.toLowerCase()));
    if (forbidden) return 0;
  }

  const weighted = score * (rule.weight ?? 1);
  return weighted;
}

function topRule(event: TimelineEvent, rules: EventRule[]): { rule: EventRule; score: number } | null {
  const candidates = rules
    .map((rule) => ({ rule, score: scoreRule(rule, event) }))
    .filter((x) => x.score >= (x.rule.minScore ?? 1))
    .sort((a, b) => b.score - a.score);

  return candidates[0] ?? null;
}

export async function classifyEvents(
  timeline: TimelineEvent[],
  options: ClassifyOptions,
): Promise<MajorEvent[]> {
  const majorEvents: MajorEvent[] = [];

  for (let i = 0; i < timeline.length; i += 1) {
    const event = timeline[i];
    const match = topRule(event, options.rules);
    if (!match) continue;

    const followupIds = timeline
      .slice(i + 1, i + 1 + options.followUpWindow)
      .slice(0, options.followUpCount)
      .map((next) => next.id);

    const major: MajorEvent = {
      id: stableId(event.id, match.rule.id, event.ts),
      client: event.client,
      ts: event.ts,
      type: match.rule.eventType,
      title: `${match.rule.eventType}: ${event.label}`,
      summary: event.detail.slice(0, 220),
      score: Number(match.score.toFixed(2)),
      triggerEventId: event.id,
      followUpEventIds: followupIds,
      ruleId: match.rule.id,
    };

    if (options.llm?.enabled) {
      try {
        const llmSummary = await summarizeMajorEventWithLLM({
          config: options.llm,
          major,
          timeline,
        });
        if (llmSummary) {
          major.summary = llmSummary;
        }
      } catch {
        // Keep deterministic rule summary when LLM fails.
      }
    }

    majorEvents.push(major);
  }

  return majorEvents;
}
