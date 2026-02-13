import { createInterface } from "node:readline";
import { createInterface as createInterfacePrompts } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { formatDate } from "../../core/src";
import type { ExportPayload, MajorEvent, ProjectCandidate, ReplaySegment, PromptPreview } from "../../shared-types/src";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";

function colorForType(type: MajorEvent["type"]): string {
  switch (type) {
    case "GOAL":
      return GREEN;
    case "PENALTY":
    case "YELLOW_CARD":
      return YELLOW;
    case "RED_CARD":
      return RED;
    default:
      return CYAN;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function getReplayById(replay: ReplaySegment[], eventId: string): ReplaySegment | undefined {
  return replay.find((item) => item.eventId === eventId);
}

function interpretationLabel(kind: string): string {
  if (kind === "feature_polish") return "feature polish";
  if (kind === "stuck_issue") return "stuck issue";
  return "normal iteration";
}

function shortTime(ts: number): string {
  const iso = formatDate(ts);
  return iso.slice(11, 16);
}

function buildRightPanelLines(
  payload: ExportPayload,
  focus: MajorEvent | undefined,
  replay: ReplaySegment | undefined,
): string[] {
  const lines: string[] = [];

  if (focus) {
    lines.push(`${BOLD}Event Detail${RESET}`);
    lines.push(`${colorForType(focus.type)}${focus.type}${RESET} @ ${formatDate(focus.ts)}`);
    lines.push(focus.summary);
    lines.push("");
  }

  if (replay) {
    lines.push(`${BOLD}After Actions${RESET} (${replay.after.length})`);
    replay.after.slice(0, 6).forEach((item) => {
      lines.push(`- ${item.label}`);
    });
    lines.push("");
  }

  const chain = focus ? payload.actionChains.find((item) => item.majorEventId === focus.id) : undefined;
  if (chain) {
    lines.push(`${BOLD}Action Chain${RESET}`);
    lines.push(chain.summary);
    lines.push("");
  }

  if (payload.generation?.status === "ok") {
    lines.push(`${BOLD}LLM Answer${RESET}`);
    lines.push(payload.generation.output.replace(/\s+/g, " "));
    lines.push("");
  }

  const insights = payload.insights;
  if (insights) {
    lines.push(`${BOLD}What You Did${RESET}`);
    if (insights.timelineNarrative.length === 0) {
      lines.push("No activity phases could be summarized.");
    } else {
      insights.timelineNarrative.slice(0, 3).forEach((segment) => {
        lines.push(`${segment.title} ${segment.summary}`);
      });
    }
    lines.push("");

    lines.push(`${BOLD}Instruction Flow${RESET} (${insights.instructions.length})`);
    insights.instructions.slice(0, 5).forEach((item, idx) => {
      lines.push(`${idx + 1}. [${shortTime(item.ts)}] ${item.text}`);
    });
    lines.push("");

    lines.push(`${BOLD}Repetition Diagnosis${RESET}`);
    if (insights.repetition.length === 0) {
      lines.push("No significant repeated instruction clusters.");
    } else {
      insights.repetition.slice(0, 4).forEach((cluster) => {
        lines.push(`- ${cluster.topic} x${cluster.count} (${interpretationLabel(cluster.interpretation)})`);
      });
    }
    lines.push("");

    lines.push(`${BOLD}Note/Raw Delta (Secondary)${RESET}`);
    if (insights.featureDeltas.length === 0) {
      lines.push("No code-level before/after delta could be inferred.");
    } else {
      insights.featureDeltas.slice(0, 3).forEach((delta) => {
        lines.push(`- ${delta.area}: ${delta.before} -> ${delta.after}`);
      });
    }
  }

  return lines;
}

export interface TUIState {
  payload: ExportPayload;
}

export function buildFrameLines(state: TUIState, selected: number, filter: MajorEvent["type"] | "ALL"): string[] {
  const width = process.stdout.columns || 120;
  const split = Math.floor(width * 0.58);

  const all = state.payload.majorEvents;
  const filtered = filter === "ALL" ? all : all.filter((x) => x.type === filter);
  const safeIndex = clamp(selected, 0, Math.max(0, filtered.length - 1));
  const focus = filtered[safeIndex];
  const replay = focus ? getReplayById(state.payload.replay, focus.id) : undefined;
  const rightLines = buildRightPanelLines(state.payload, focus, replay);

  const lines: string[] = [];
  lines.push(`${BOLD}Proofline Arena${RESET} ${DIM}(in-client single source mode)${RESET}`);
  lines.push(`${CYAN}Client:${RESET} ${state.payload.context.client}  ${CYAN}Range:${RESET} ${formatDate(state.payload.context.startedAt)} -> ${formatDate(state.payload.context.endedAt)}  ${CYAN}Filter:${RESET} ${filter}`);
  lines.push(
    `${CYAN}Timeline:${RESET} ${state.payload.timeline.length}  ${CYAN}Major:${RESET} ${state.payload.majorEvents.length}  ${CYAN}Evidence:${RESET} ${state.payload.evidence.length}  ${CYAN}Conflicts:${RESET} ${state.payload.conflicts.length}`,
  );
  lines.push("-".repeat(width));

  const listHeight = Math.max(10, (process.stdout.rows || 30) - 8);
  const start = Math.max(0, safeIndex - Math.floor(listHeight / 2));
  const visible = filtered.slice(start, start + listHeight);

  for (let i = 0; i < listHeight; i += 1) {
    const leftItem = visible[i];
    const rowIndex = start + i;

    let left = "";
    if (leftItem) {
      const active = rowIndex === safeIndex;
      const marker = active ? `${BOLD}>${RESET}` : " ";
      left = `${marker} ${colorForType(leftItem.type)}${leftItem.type.padEnd(12)}${RESET} ${truncate(leftItem.title, Math.max(8, split - 20))}`;
    }

    const rightRaw = rightLines[i] ?? "";
    const right = truncate(rightRaw, Math.max(10, width - split - 4));

    lines.push(`${truncate(left, split).padEnd(split)} | ${truncate(right, width - split - 3)}`);
  }

  lines.push("-".repeat(width));
  lines.push(`${DIM}Keys:${RESET} j/k move  f filter  q quit`);

  if (filtered.length === 0) {
    lines.push(`${YELLOW}No events under current filter.${RESET}`);
  }

  return lines;
}

export async function renderProjectSelection(query: string, candidates: ProjectCandidate[]): Promise<{ mode: "single"; index: number } | { mode: "all" }> {
  const rl = createInterfacePrompts({ input: stdin, output: stdout });
  stdout.write(`\n${BOLD}Proofline Project Selection${RESET}\n`);
  stdout.write(`${DIM}Query:${RESET} ${query}\n`);

  if (candidates.length === 0) {
    rl.close();
    return { mode: "all" };
  }

  stdout.write(`  0. ALL projects\n`);
  candidates.slice(0, 20).forEach((item, idx) => {
    stdout.write(`  ${idx + 1}. ${item.name} ${DIM}(${item.root})${RESET}\n`);
  });
  const answer = await rl.question(`Select project [0-${Math.min(20, candidates.length)}]: `);
  rl.close();

  const picked = Number(answer);
  if (!Number.isFinite(picked) || picked <= 0) {
    return { mode: "all" };
  }
  const index = Math.max(1, Math.min(candidates.length, picked)) - 1;
  return { mode: "single", index };
}

export async function renderPromptPreview(preview: PromptPreview): Promise<boolean> {
  const rl = createInterfacePrompts({ input: stdin, output: stdout });
  stdout.write(`\n${BOLD}Proofline Prompt Preview${RESET}\n`);
  stdout.write(`${DIM}Estimated Tokens:${RESET} ${preview.tokenEstimate}\n`);
  if (preview.warnings.length > 0) {
    stdout.write(`${YELLOW}Warnings:${RESET} ${preview.warnings.join("; ")}\n`);
  }
  stdout.write("-".repeat(process.stdout.columns || 100));
  stdout.write("\n");
  stdout.write(truncate(preview.prompt, 6000));
  stdout.write("\n");
  stdout.write("-".repeat(process.stdout.columns || 100));
  stdout.write("\n");

  const answer = await rl.question("Run generation now? [y/N]: ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function clearScreen(): void {
  process.stdout.write("\u001b[2J\u001b[H");
}

export async function renderTUI(state: TUIState): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const summary = {
      client: state.payload.context.client,
      majorEvents: state.payload.majorEvents.length,
      timeline: state.payload.timeline.length,
      startedAt: formatDate(state.payload.context.startedAt),
      endedAt: formatDate(state.payload.context.endedAt),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const filters: Array<MajorEvent["type"] | "ALL"> = [
    "ALL",
    "GOAL",
    "ASSIST",
    "PENALTY",
    "YELLOW_CARD",
    "RED_CARD",
    "CORNER",
    "OFFSIDE",
    "SUBSTITUTION",
  ];

  let selected = 0;
  let filterIdx = 0;

  function rerender(): void {
    clearScreen();
    const lines = buildFrameLines(state, selected, filters[filterIdx]);
    process.stdout.write(lines.join("\n"));
  }

  rerender();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  await new Promise<void>((resolve) => {
    const onData = (chunk: string): void => {
      if (chunk === "q" || chunk === "\u0003") {
        cleanup();
        resolve();
        return;
      }

      if (chunk === "j" || chunk === "\u001b[B") {
        selected += 1;
        rerender();
        return;
      }

      if (chunk === "k" || chunk === "\u001b[A") {
        selected -= 1;
        rerender();
        return;
      }

      if (chunk === "f") {
        filterIdx = (filterIdx + 1) % filters.length;
        selected = 0;
        rerender();
      }
    };

    const cleanup = (): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    process.stdin.on("data", onData);
  });
}
