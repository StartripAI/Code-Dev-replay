import type { ActionChain, EvidenceItem, MajorEvent, TimelineEvent } from "../../shared-types/src";
import { stableId } from "../../core/src";

function summarizeChain(major: MajorEvent, steps: TimelineEvent[]): string {
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (!first || !last) return major.summary;
  if (first.id === last.id) return `${major.type}: ${first.label}`;
  return `${major.type}: ${first.label} -> ${last.label}`;
}

export function buildActionChains(
  timeline: TimelineEvent[],
  majorEvents: MajorEvent[],
  evidence: EvidenceItem[],
): ActionChain[] {
  const indexById = new Map<string, TimelineEvent>();
  for (const event of timeline) {
    indexById.set(event.id, event);
  }

  const evidenceByEvent = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    if (!item.eventId) continue;
    const list = evidenceByEvent.get(item.eventId) ?? [];
    list.push(item);
    evidenceByEvent.set(item.eventId, list);
  }

  return majorEvents.map((major) => {
    const focus = indexById.get(major.triggerEventId);
    const followups = major.followUpEventIds.map((id) => indexById.get(id)).filter(Boolean) as TimelineEvent[];
    const steps = [focus, ...followups].filter(Boolean) as TimelineEvent[];
    const flattenedEvidence = steps.flatMap((step) => evidenceByEvent.get(step.id) ?? []);
    const confidence =
      flattenedEvidence.length > 0
        ? flattenedEvidence.reduce((sum, item) => sum + item.confidence, 0) / flattenedEvidence.length
        : 0.72;

    return {
      id: stableId("action_chain", major.id),
      majorEventId: major.id,
      projectId: flattenedEvidence[0]?.projectId,
      summary: summarizeChain(major, steps),
      confidence: Number(confidence.toFixed(3)),
      steps: steps.map((step) => ({
        eventId: step.id,
        ts: step.ts,
        label: step.label,
        detail: step.detail,
        actor: step.actor,
        evidenceIds: (evidenceByEvent.get(step.id) ?? []).map((x) => x.id),
      })),
    };
  });
}

