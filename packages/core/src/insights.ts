import { basename, normalize, relative, resolve } from "node:path";
import type {
  AnalysisInsights,
  EvidenceItem,
  FeatureDelta,
  MajorEvent,
  ProjectScope,
  QueryIntent,
  RepetitionCluster,
  TimelineEvent,
  TimelineNarrativeSegment,
  UserInstruction,
} from "../../shared-types/src";
import { stableId } from "./utils";

const EN_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "in",
  "of",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "with",
  "that",
  "this",
  "it",
  "what",
  "which",
  "did",
  "do",
  "does",
  "yesterday",
  "today",
  "last",
  "days",
  "day",
  "project",
  "repo",
  "folder",
  "workspace",
  "please",
  "need",
  "type",
  "input",
  "text",
  "go",
  "ahead",
  "implement",
  "plan",
]);

const ZH_STOPWORDS = new Set([
  "我",
  "你",
  "他",
  "她",
  "它",
  "我们",
  "你们",
  "他们",
  "做",
  "做了",
  "什么",
  "哪些",
  "项目",
  "昨天",
  "今天",
  "最近",
  "三天",
  "一下",
  "这个",
  "那个",
  "然后",
  "现在",
  "帮我",
  "请",
  "需要",
  "就是",
  "还是",
  "已经",
  "进行",
  "继续",
  "分析",
  "改动",
  "更新",
  "修复",
]);

interface AnalyzeInsightsInput {
  query: QueryIntent;
  scope: ProjectScope;
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  majorEvents: MajorEvent[];
}

interface RepetitionCandidate {
  id: string;
  topic: string;
  kind: RepetitionCluster["kind"];
  instructionIds: string[];
  interpretation: RepetitionCluster["interpretation"];
  count: number;
}

interface FileAreaGroup {
  area: string;
  projectId?: string;
  files: Set<string>;
  evidenceIds: string[];
  confidenceSum: number;
  count: number;
  firstTs: number;
  lastTs: number;
}

interface SegmentWindow {
  start: number;
  end: number;
  events: TimelineEvent[];
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[`*_#<>\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFieldFromJsonLike(text: string): string | null {
  const strict = text.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
  let captured = strict?.[1] ?? null;
  if (!captured) {
    const marker = text.match(/"text"\s*:\s*"/);
    if (marker?.index === undefined) return null;
    const start = marker.index + marker[0].length;
    let escaped = false;
    let out = "";
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        out += char;
        escaped = true;
        continue;
      }
      if (char === "\"") break;
      out += char;
    }
    captured = out.trim() || null;
  }
  if (!captured) return null;

  const unescaped = captured
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ");
  const cleaned = stripMarkdown(unescaped);
  return cleaned || null;
}

function collectTextFields(value: unknown, out: string[], depth = 0): void {
  if (depth > 5 || out.length > 20) return;
  if (typeof value === "string") {
    const raw = value.trim();
    const textField = extractTextFieldFromJsonLike(raw);
    if (textField) {
      out.push(textField);
      return;
    }
    if (raw.startsWith("{") || raw.startsWith("[") || ((raw.startsWith('"') || raw.startsWith("'")) && raw.length > 2)) {
      const parsed = safeJsonParse(raw);
      if (parsed !== null) {
        collectTextFields(parsed, out, depth + 1);
        return;
      }
    }
    const cleaned = stripMarkdown(value);
    if (cleaned) out.push(cleaned);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, out, depth + 1);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const obj = value as Record<string, unknown>;
  const preferredKeys = ["text", "content", "message", "input", "prompt", "detail"];
  let consumedPreferred = false;
  for (const key of preferredKeys) {
    if (key in obj) {
      consumedPreferred = true;
      collectTextFields(obj[key], out, depth + 1);
    }
  }

  if (consumedPreferred) return;

  for (const [key, item] of Object.entries(obj)) {
    if (key === "type" || key === "role" || key === "id" || key === "name") continue;
    if (typeof item === "string") continue;
    collectTextFields(item, out, depth + 1);
  }
}

function extractReadableText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const regexText = extractTextFieldFromJsonLike(trimmed);
  if (regexText) return regexText;

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const firstParse = safeJsonParse(trimmed);
    if (typeof firstParse === "string") {
      return extractReadableText(firstParse);
    }
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = safeJsonParse(trimmed);
    if (parsed !== null) {
      const fields: string[] = [];
      collectTextFields(parsed, fields);
      const joined = fields
        .map((item) => item.trim())
        .filter(Boolean)
        .join(" ");
      if (joined) return joined.length > 1500 ? `${joined.slice(0, 1500)}...` : joined;
    }
  }

  const cleaned = stripMarkdown(trimmed);
  return cleaned.length > 1500 ? `${cleaned.slice(0, 1500)}...` : cleaned;
}

function isBoilerplateInstruction(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.startsWith("# agents.md instructions")) return true;
  if (normalized.startsWith("<environment_context>")) return true;
  if (normalized.startsWith("environment context")) return true;
  if (normalized.includes("cwd /users/") && normalized.includes("shell zsh")) return true;
  if (normalized.includes("a skill is a set of local instructions")) return true;
  if (normalized.includes("turn aborted by user")) return true;
  if (normalized.includes("turn aborted")) return true;
  return false;
}

function normalizeInstructionText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._/\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const tokens = text.match(/[\u4e00-\u9fff]{1,4}|[a-z0-9][a-z0-9._/\-]{1,}/giu) ?? [];
  return tokens
    .map((token) => token.toLowerCase())
    .filter((token) => {
      if (/^[\u4e00-\u9fff]+$/u.test(token)) return !ZH_STOPWORDS.has(token);
      return !EN_STOPWORDS.has(token);
    })
    .slice(0, 14);
}

function topTopicTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length > 1).slice(0, 3);
}

function isTrivialInstruction(instruction: UserInstruction): boolean {
  const normalized = instruction.normalized;
  if (!normalized) return true;
  if (/^(go|go on|continue|ok|okay|yes|done|run|继续|好的|开始|走起)$/.test(normalized)) return true;
  if (/^\d+\s*\.?\s*(go|go on|go ahead|continue)$/.test(normalized)) return true;
  return instruction.tokens.length <= 1 && normalized.length <= 8;
}

function buildUserInstructions(timeline: TimelineEvent[]): UserInstruction[] {
  return timeline
    .filter((event) => event.actor === "user")
    .map((event) => {
      const text = extractReadableText(String(event.detail ?? ""));
      const normalized = normalizeInstructionText(text);
      return {
        id: stableId("instruction", event.id),
        ts: event.ts,
        text,
        normalized,
        tokens: tokenize(normalized),
        sourceEventId: event.id,
      };
    })
    .filter((item) => item.text.length > 0 && !isBoilerplateInstruction(item.text))
    .sort((a, b) => a.ts - b.ts);
}

function binarySearchLeft(sortedTs: number[], target: number): number {
  let left = 0;
  let right = sortedTs.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedTs[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left;
}

function binarySearchRight(sortedTs: number[], target: number): number {
  let left = 0;
  let right = sortedTs.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedTs[mid] <= target) left = mid + 1;
    else right = mid;
  }
  return left;
}

function computeFileChangeAroundInstructions(
  instructionTs: number[],
  evidence: EvidenceItem[],
  windowMs: number,
): number {
  const fileChanges = evidence.filter((item) => item.type === "file_change").sort((a, b) => a.ts - b.ts);
  if (fileChanges.length === 0 || instructionTs.length === 0) return 0;

  const tsList = fileChanges.map((item) => item.ts);
  let total = 0;
  for (const ts of instructionTs) {
    const start = binarySearchLeft(tsList, ts - windowMs);
    const end = binarySearchRight(tsList, ts + windowMs);
    total += Math.max(0, end - start);
  }
  return total;
}

function hasStuckLanguage(texts: string[]): boolean {
  const merged = texts.join(" ").toLowerCase();
  return /(还是|仍然|不行|失败|报错|卡住|没好|again|still|retry|not\s+work|cannot|can't|failed|error)/.test(
    merged,
  );
}

function inferRepetitionInterpretation(
  kind: RepetitionCluster["kind"],
  count: number,
  texts: string[],
  fileChangeAround: number,
): RepetitionCluster["interpretation"] {
  if (count >= 3 && kind === "exact_repeat" && (hasStuckLanguage(texts) || fileChangeAround <= 1)) {
    return "stuck_issue";
  }
  if (count >= 3 && fileChangeAround >= Math.max(2, count - 1)) {
    return "feature_polish";
  }
  return "normal_iteration";
}

function buildRepetitionClusters(instructions: UserInstruction[], evidence: EvidenceItem[]): RepetitionCluster[] {
  const scopedInstructions = instructions.filter((item) => !isTrivialInstruction(item));
  const byNormalized = new Map<string, UserInstruction[]>();
  for (const instruction of scopedInstructions) {
    if (!instruction.normalized) continue;
    const list = byNormalized.get(instruction.normalized) ?? [];
    list.push(instruction);
    byNormalized.set(instruction.normalized, list);
  }

  const byTopic = new Map<string, UserInstruction[]>();
  for (const instruction of scopedInstructions) {
    const topicTokens = topTopicTokens(instruction.tokens);
    if (topicTokens.length === 0) continue;
    const key = topicTokens.join("|");
    const list = byTopic.get(key) ?? [];
    list.push(instruction);
    byTopic.set(key, list);
  }

  const candidates: RepetitionCandidate[] = [];

  for (const [normalized, group] of byNormalized.entries()) {
    if (group.length < 2) continue;
    const ts = group.map((item) => item.ts);
    const fileChangeAround = computeFileChangeAroundInstructions(ts, evidence, 20 * 60 * 1000);
    candidates.push({
      id: stableId("repeat", "exact", normalized),
      topic: group[0]?.tokens.slice(0, 3).join(" / ") || normalized.slice(0, 80),
      kind: "exact_repeat",
      instructionIds: group.map((item) => item.id),
      count: group.length,
      interpretation: inferRepetitionInterpretation(
        "exact_repeat",
        group.length,
        group.map((item) => item.text),
        fileChangeAround,
      ),
    });
  }

  for (const [topic, group] of byTopic.entries()) {
    if (group.length < 2) continue;
    const allNormalizedEqual = group.every((item) => item.normalized === group[0]?.normalized);
    if (allNormalizedEqual) continue;

    const ts = group.map((item) => item.ts);
    const fileChangeAround = computeFileChangeAroundInstructions(ts, evidence, 20 * 60 * 1000);
    candidates.push({
      id: stableId("repeat", "topic", topic),
      topic: topic.replaceAll("|", " / "),
      kind: "topic_repeat",
      instructionIds: group.map((item) => item.id),
      count: group.length,
      interpretation: inferRepetitionInterpretation(
        "topic_repeat",
        group.length,
        group.map((item) => item.text),
        fileChangeAround,
      ),
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.kind.localeCompare(b.kind);
    })
    .slice(0, 12)
    .map((candidate) => ({
      id: candidate.id,
      topic: candidate.topic || "general",
      count: candidate.count,
      instructionIds: candidate.instructionIds,
      kind: candidate.kind,
      interpretation: candidate.interpretation,
    }));
}

function matchProjectRoot(scope: ProjectScope, path: string, projectId?: string): string | undefined {
  if (scope.mode === "single") return scope.project.root;
  if (projectId) {
    const byId = scope.projects.find((project) => project.id === projectId);
    if (byId) return byId.root;
  }
  return scope.projects.find((project) => path.startsWith(project.root))?.root;
}

function deriveArea(scope: ProjectScope, pathRaw: string, projectId?: string): string {
  const path = normalize(resolve(pathRaw));
  const root = matchProjectRoot(scope, path, projectId);
  const rel = root ? relative(root, path) : basename(path);
  const cleaned = rel.replaceAll("\\", "/");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0) return basename(path);
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function captureBeforeAfterPhrase(text: string): { before?: string; after?: string } {
  const trimmed = stripMarkdown(extractReadableText(text));
  if (!trimmed) return {};
  if (/(fromnodeid|tonodeid|artifactedge| uuid | let | func | struct | class )/i.test(` ${trimmed} `)) {
    return {};
  }

  const zh = trimmed.match(/从(.{1,80})改成(.{1,80})/);
  if (zh) {
    return { before: zh[1].trim(), after: zh[2].trim() };
  }

  const arrow = trimmed.match(/(.{1,100})\s*->\s*(.{1,100})/);
  if (arrow) {
    return { before: arrow[1].trim(), after: arrow[2].trim() };
  }

  const en = trimmed.match(/from\s+(.{1,80})\s+to\s+(.{1,80})/i);
  if (en) {
    return { before: en[1].trim(), after: en[2].trim() };
  }

  return {};
}

function scoreEvidenceCandidate(
  item: EvidenceItem,
  mode: "before" | "after",
  anchorTs: number,
  areaTokens: string[],
): number {
  const text = extractReadableText(item.detail);
  let score = 0;
  if (mode === "before") {
    if (item.type === "user_text") score += 4;
    if (item.type === "assistant_text") score += 2;
  } else {
    if (item.type === "tool_result") score += 4;
    if (item.type === "assistant_text") score += 3;
  }

  if (/(改成|修复|删除|新增|调整|优化|update|fix|remove|add|refactor|migrate|rewrite)/i.test(text)) {
    score += 3;
  }
  if (captureBeforeAfterPhrase(text).before || captureBeforeAfterPhrase(text).after) {
    score += 5;
  }
  if (areaTokens.some((token) => token && text.toLowerCase().includes(token))) {
    score += 2;
  }
  if (/(exit code|wall time|output:|\[(wdyd|devreplay|proofline)\]|experimentalwarning|select project)/i.test(text)) {
    score -= 6;
  }
  if (/(rerunning|re-run|query|export|insights|inspection|test updates)/i.test(text)) {
    score -= 8;
  }

  const distance = Math.abs(item.ts - anchorTs);
  score -= distance / (60 * 60 * 1000);
  return score;
}

function findNearestEvidence(
  evidence: EvidenceItem[],
  group: FileAreaGroup,
): { before?: EvidenceItem; after?: EvidenceItem; phrase?: { before?: string; after?: string } } {
  const windowStart = group.firstTs - 45 * 60 * 1000;
  const windowEnd = group.lastTs + 45 * 60 * 1000;
  const scoped = evidence.filter((item) => {
    if (item.ts < windowStart || item.ts > windowEnd) return false;
    if (!group.projectId) return true;
    return item.projectId === group.projectId;
  });
  const areaTokens = tokenize(normalizeInstructionText(group.area.replaceAll("/", " ")));

  const beforeCandidates = scoped.filter(
    (item) => item.ts <= group.firstTs && (item.type === "user_text" || item.type === "assistant_text"),
  );
  const afterCandidates = scoped.filter(
    (item) => item.ts >= group.lastTs && (item.type === "tool_result" || item.type === "assistant_text"),
  );

  const pickBest = (candidates: EvidenceItem[], mode: "before" | "after", anchorTs: number): EvidenceItem | undefined => {
    const ranked = candidates
      .map((item) => ({
        item,
        score: scoreEvidenceCandidate(item, mode, anchorTs, areaTokens),
      }))
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) return undefined;
    if (ranked[0].score <= 0) return undefined;
    return ranked[0].item;
  };

  const before = pickBest(beforeCandidates, "before", group.firstTs);
  const after = pickBest(afterCandidates, "after", group.lastTs);

  const phraseSources = [before?.detail ?? "", after?.detail ?? ""].filter(Boolean);
  for (const source of phraseSources) {
    const phrase = captureBeforeAfterPhrase(source);
    if (phrase.before || phrase.after) {
      return { before, after, phrase };
    }
  }

  return { before, after };
}

function summarizeEvidenceText(text: string, fallback: string): string {
  const cleaned = stripMarkdown(extractReadableText(text));
  if (!cleaned) return fallback;
  const symbols = (cleaned.match(/[{}()[\];<>:=]/g) ?? []).length;
  const symbolRatio = symbols / Math.max(1, cleaned.length);
  if (symbolRatio > 0.08 && cleaned.length > 45) {
    return fallback;
  }
  if (/^\w+\s*:\s*\w+(,\s*\w+\s*:\s*\w+){2,}/.test(cleaned)) {
    return fallback;
  }
  if (/(fromnodeid|tonodeid|artifactedge| uuid | let | func | struct | class )/i.test(` ${cleaned} `)) {
    return fallback;
  }
  return cleaned.length > 110 ? `${cleaned.slice(0, 110)}...` : cleaned;
}

function buildFeatureDeltas(scope: ProjectScope, evidence: EvidenceItem[]): FeatureDelta[] {
  const fileChanges = evidence.filter((item) => item.type === "file_change");
  if (fileChanges.length === 0) return [];

  const byArea = new Map<string, FileAreaGroup>();
  for (const item of fileChanges) {
    const area = deriveArea(scope, item.sourcePath, item.projectId);
    const key = `${item.projectId ?? "-"}|${area}`;
    const existing = byArea.get(key);
    if (existing) {
      existing.files.add(item.sourcePath);
      existing.evidenceIds.push(item.id);
      existing.confidenceSum += item.confidence;
      existing.count += 1;
      existing.firstTs = Math.min(existing.firstTs, item.ts);
      existing.lastTs = Math.max(existing.lastTs, item.ts);
      continue;
    }
    byArea.set(key, {
      area,
      projectId: item.projectId,
      files: new Set([item.sourcePath]),
      evidenceIds: [item.id],
      confidenceSum: item.confidence,
      count: 1,
      firstTs: item.ts,
      lastTs: item.ts,
    });
  }

  return [...byArea.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastTs - a.lastTs;
    })
    .slice(0, 10)
    .map((group) => {
      const nearest = findNearestEvidence(evidence, group);
      const files = [...group.files].sort().slice(0, 6);

      const before =
        nearest.phrase?.before ??
        (nearest.before
          ? summarizeEvidenceText(nearest.before.detail, `Started working on issues in ${group.area}`)
          : `Started from the prior implementation and behavior in ${group.area}`);
      const after =
        nearest.phrase?.after ??
        (nearest.after
          ? summarizeEvidenceText(nearest.after.detail, `Completed and validated changes in ${group.area}`)
          : `Applied and saved changes in ${files.map((file) => basename(file)).join(", ")}`);

      const basis = uniqIds([
        ...group.evidenceIds.slice(0, 8),
        nearest.before?.id,
        nearest.after?.id,
      ]);
      const confidence = Number(Math.min(0.99, group.confidenceSum / Math.max(1, group.count)).toFixed(3));

      return {
        id: stableId("delta", group.projectId ?? "-", group.area, group.firstTs, group.lastTs),
        area: group.area,
        files,
        before,
        after,
        basis,
        confidence,
      };
    });
}

function uniqIds(items: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function splitSegments(timeline: TimelineEvent[]): SegmentWindow[] {
  if (timeline.length === 0) return [];
  const maxGap = 2 * 60 * 60 * 1000;
  const maxEventsPerSegment = 1200;
  const segments: SegmentWindow[] = [];
  let current: SegmentWindow = {
    start: timeline[0].ts,
    end: timeline[0].ts,
    events: [],
  };

  for (const event of timeline) {
    const previous = current.events[current.events.length - 1];
    const hitGap = previous ? event.ts - previous.ts > maxGap : false;
    const hitSize = current.events.length >= maxEventsPerSegment;
    if (current.events.length > 0 && (hitGap || hitSize)) {
      segments.push(current);
      current = {
        start: event.ts,
        end: event.ts,
        events: [],
      };
    }
    current.events.push(event);
    current.end = event.ts;
  }
  if (current.events.length > 0) segments.push(current);
  return segments.slice(0, 8);
}

function phaseTitle(
  segment: SegmentWindow,
  majorEvents: MajorEvent[],
  evidence: EvidenceItem[],
  idx: number,
): string {
  const hasGoal = majorEvents.some((item) => item.type === "GOAL" && item.ts >= segment.start && item.ts <= segment.end);
  if (hasGoal) return `Phase ${idx + 1}: Delivery progress`;
  const hasRisk = majorEvents.some(
    (item) => (item.type === "PENALTY" || item.type === "YELLOW_CARD" || item.type === "RED_CARD") && item.ts >= segment.start && item.ts <= segment.end,
  );
  if (hasRisk) return `Phase ${idx + 1}: Issue handling`;

  const fileChanges = evidence.filter((item) => item.type === "file_change" && item.ts >= segment.start && item.ts <= segment.end)
    .length;
  if (fileChanges > 0) return `Phase ${idx + 1}: Implementation iteration`;
  return `Phase ${idx + 1}: Requirement shaping`;
}

function summarizeSegment(
  segment: SegmentWindow,
  majorEvents: MajorEvent[],
  evidence: EvidenceItem[],
  instructions: UserInstruction[],
): string {
  const users = segment.events.filter((event) => event.actor === "user").length;
  const assistants = segment.events.filter((event) => event.actor === "assistant").length;
  const systems = segment.events.filter((event) => event.actor === "system").length;

  const evidenceInSegment = evidence.filter((item) => item.ts >= segment.start && item.ts <= segment.end);
  const fileChanges = evidenceInSegment.filter((item) => item.type === "file_change");
  const toolOps = evidenceInSegment.filter((item) => item.type === "tool_call" || item.type === "tool_result").length;
  const majors = majorEvents.filter((item) => item.ts >= segment.start && item.ts <= segment.end);
  const instructionsInSegment = instructions.filter((item) => item.ts >= segment.start && item.ts <= segment.end);

  const topIntent = instructionsInSegment
    .flatMap((item) => item.tokens.slice(0, 2))
    .filter(Boolean)
    .filter((token, idx, arr) => arr.indexOf(token) === idx)
    .slice(0, 4)
    .join(" / ");

  const majorSummary =
    majors.length > 0
      ? `Detected ${majors.length} major events in this phase (${majors
          .slice(0, 3)
          .map((item) => item.type)
          .join(", ")}).`
      : "No clear major event in this phase; work mainly progressed steadily.";

  const intentLine = topIntent ? `User intent concentrated on ${topIntent}.` : "User instructions mostly refined the same active task.";

  return [
    `This phase has ${segment.events.length} timeline events (user ${users}, assistant ${assistants}, system ${systems}), ${toolOps} tool call/results, and ${fileChanges.length} file changes.`,
    intentLine,
    majorSummary,
  ].join(" ");
}

function buildTimelineNarrative(
  timeline: TimelineEvent[],
  majorEvents: MajorEvent[],
  evidence: EvidenceItem[],
  instructions: UserInstruction[],
): TimelineNarrativeSegment[] {
  const segments = splitSegments(timeline);
  return segments.map((segment, idx) => {
    const evidenceIds = evidence
      .filter((item) => item.ts >= segment.start && item.ts <= segment.end)
      .slice(0, 12)
      .map((item) => item.id);

    return {
      id: stableId("narrative", idx, segment.start, segment.end),
      start: segment.start,
      end: segment.end,
      title: phaseTitle(segment, majorEvents, evidence, idx),
      summary: summarizeSegment(segment, majorEvents, evidence, instructions),
      evidenceIds,
    };
  });
}

export function analyzeInsights(input: AnalyzeInsightsInput): AnalysisInsights {
  const instructions = buildUserInstructions(input.timeline);
  const repetition = buildRepetitionClusters(instructions, input.evidence);
  const featureDeltas = buildFeatureDeltas(input.scope, input.evidence);
  const timelineNarrative = buildTimelineNarrative(input.timeline, input.majorEvents, input.evidence, instructions);

  return {
    instructions,
    repetition,
    featureDeltas,
    timelineNarrative,
  };
}
