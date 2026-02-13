import type {
  ActionChain,
  AnalysisInsights,
  EvidenceConflict,
  MajorEvent,
  PromptPreview,
  ProjectScope,
  QueryIntent,
  TimelineEvent,
} from "../../shared-types/src";

export interface BuildPromptInput {
  query: QueryIntent;
  scope: ProjectScope;
  timeline: TimelineEvent[];
  majorEvents: MajorEvent[];
  actionChains: ActionChain[];
  conflicts: EvidenceConflict[];
  insights?: AnalysisInsights;
}

function estimateTokens(text: string): number {
  // Rough estimate for mixed-language prompts.
  return Math.ceil(text.length / 2.6);
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function compactTimeline(events: TimelineEvent[], limit: number): Array<Record<string, unknown>> {
  return events.slice(-limit).map((event) => ({
    id: event.id,
    ts: event.ts,
    label: truncateText(event.label, 80),
    detail: truncateText(event.detail, 100),
    actor: event.actor,
    tags: event.tags.slice(0, 4),
    source: event.sourcePath.split("/").slice(-1).join("/"),
  }));
}

function compactMajorEvents(events: MajorEvent[], limit: number): Array<Record<string, unknown>> {
  return events.slice(0, limit).map((event) => ({
    id: event.id,
    ts: event.ts,
    type: event.type,
    title: truncateText(event.title, 90),
    summary: truncateText(event.summary, 120),
    score: event.score,
    triggerEventId: event.triggerEventId,
  }));
}

function compactActionChains(chains: ActionChain[], limit: number): Array<Record<string, unknown>> {
  return chains.slice(0, limit).map((chain) => ({
    id: chain.id,
    majorEventId: chain.majorEventId,
    summary: truncateText(chain.summary, 100),
    confidence: chain.confidence,
    steps: chain.steps.slice(0, 3).map((step) => ({
      ts: step.ts,
      label: truncateText(step.label, 60),
      actor: step.actor,
    })),
  }));
}

function compactConflicts(conflicts: EvidenceConflict[], limit: number): Array<Record<string, unknown>> {
  return conflicts.slice(0, limit).map((conflict) => ({
    id: conflict.id,
    winnerEvidenceId: conflict.winnerEvidenceId,
    discardedCount: conflict.discardedEvidenceIds.length,
    reason: conflict.reason,
    confidence: conflict.confidence,
  }));
}

function buildPayload(input: BuildPromptInput, limits: {
  timeline: number;
  major: number;
  chains: number;
  conflicts: number;
  instructions: number;
  repetition: number;
  narrative: number;
  deltas: number;
}): Record<string, unknown> {
  return {
    query_intent: input.query,
    project_scope: input.scope,
    timeline: compactTimeline(input.timeline, limits.timeline),
    major_events: compactMajorEvents(input.majorEvents, limits.major),
    action_chains: compactActionChains(input.actionChains, limits.chains),
    conflicts: compactConflicts(input.conflicts, limits.conflicts),
    instruction_analysis: {
      instructions:
        input.insights?.instructions.slice(0, limits.instructions).map((item) => ({
          ts: item.ts,
          text: truncateText(item.text, 120),
          tokens: item.tokens.slice(0, 4),
        })) ?? [],
      repetition: input.insights?.repetition.slice(0, limits.repetition) ?? [],
    },
    timeline_narrative:
      input.insights?.timelineNarrative.slice(0, limits.narrative).map((item) => ({
        title: item.title,
        summary: truncateText(item.summary, 160),
        start: item.start,
        end: item.end,
      })) ?? [],
    feature_deltas:
      input.insights?.featureDeltas.slice(0, limits.deltas).map((item) => ({
        area: item.area,
        before: truncateText(item.before, 120),
        after: truncateText(item.after, 120),
        files: item.files.slice(0, 4),
        confidence: item.confidence,
      })) ?? [],
    confidence_summary: {
      timeline_count: input.timeline.length,
      major_events_count: input.majorEvents.length,
      action_chains_count: input.actionChains.length,
      conflict_count: input.conflicts.length,
      instruction_count: input.insights?.instructions.length ?? 0,
      repetition_cluster_count: input.insights?.repetition.length ?? 0,
      feature_delta_count: input.insights?.featureDeltas.length ?? 0,
    },
    output_contract: {
      direct_answer: "string",
      match_commentary: "string",
      what_you_did_first: "array",
      instruction_flow: "array",
      repetition_diagnosis: "array",
      project_breakdown: "array",
      file_changes_secondary: "array",
      major_events_explained: "array",
      after_actions: "array",
      raw_note_deltas: "array",
      confidence_notes: "string",
      unknowns: "array",
    },
  };
}

export function buildStandardPrompt(input: BuildPromptInput): PromptPreview {
  const limits = {
    timeline: 120,
    major: 32,
    chains: 24,
    conflicts: 32,
    instructions: 24,
    repetition: 12,
    narrative: 8,
    deltas: 8,
  };
  let compressed = false;
  let payload = buildPayload(input, limits);
  let prompt = [
    "You are Proofline match desk analyst.",
    "Language: en-US.",
    "Rules:",
    "1) Use evidence-first reasoning.",
    "2) Activity-first output: explain what user did before listing files.",
    "3) Explain user instruction sequence and repetitive patterns.",
    "4) Distinguish feature polishing vs stuck issue when repeated.",
    "5) For feature deltas, explicitly write before -> after.",
    "6) If information is unproven, mark it as inference.",
    "7) Return valid JSON object only; no markdown.",
    "8) Follow output_contract exactly.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");

  let tokenEstimate = estimateTokens(prompt);
  while (tokenEstimate > 9_000 && limits.timeline > 8) {
    compressed = true;
    limits.timeline = Math.max(8, Math.floor(limits.timeline * 0.7));
    limits.major = Math.max(8, Math.floor(limits.major * 0.75));
    limits.chains = Math.max(6, Math.floor(limits.chains * 0.75));
    limits.conflicts = Math.max(8, Math.floor(limits.conflicts * 0.75));
    limits.instructions = Math.max(6, Math.floor(limits.instructions * 0.75));
    limits.repetition = Math.max(4, Math.floor(limits.repetition * 0.75));
    limits.narrative = Math.max(3, Math.floor(limits.narrative * 0.75));
    limits.deltas = Math.max(3, Math.floor(limits.deltas * 0.75));

    payload = buildPayload(input, limits);
    prompt = [
      "You are Proofline match desk analyst.",
      "Language: en-US.",
      "Rules:",
      "1) Use evidence-first reasoning.",
      "2) Explain user instruction sequence and repetitive patterns.",
      "3) Distinguish feature polishing vs stuck issue when repeated.",
      "4) For feature deltas, explicitly write before -> after.",
      "5) If information is unproven, mark it as inference.",
      "6) Return valid JSON object only; no markdown.",
      "7) Follow output_contract exactly.",
      "",
      JSON.stringify(payload, null, 2),
    ].join("\n");
    tokenEstimate = estimateTokens(prompt);
  }

  const warnings: string[] = [];
  if (input.timeline.length === 0) warnings.push("timeline is empty");
  if (input.majorEvents.length === 0) warnings.push("major_events is empty");
  if (input.scope.mode === "all" && input.scope.projects.length > 8) warnings.push("project_scope is wide; answers may be less specific");
  if ((input.insights?.instructions.length ?? 0) === 0) warnings.push("instruction_analysis is empty");
  if (compressed) warnings.push("prompt compressed for token budget");

  return {
    prompt,
    tokenEstimate,
    warnings,
  };
}
