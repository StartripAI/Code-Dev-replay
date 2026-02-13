export type ClientKind =
  | "claude"
  | "codex"
  | "cursor"
  | "vscode"
  | "antigravity"
  | "opencode";

export const CLIENT_KINDS: readonly ClientKind[] = [
  "claude",
  "codex",
  "cursor",
  "vscode",
  "antigravity",
  "opencode",
] as const;

export type SelectionSource = "auto" | "manual" | "flag" | "env";

export interface DetectedClient {
  client: ClientKind | null;
  confidence: number;
  reason: string;
  selectedBy: SelectionSource;
  candidates: ClientKind[];
}

export interface ClientPaths {
  client: ClientKind;
  roots: string[];
  files: string[];
  globs: string[];
}

export interface PathAccessRecord {
  path: string;
  action: "read" | "glob" | "sqlite" | "scan" | "runner";
  allowed: boolean;
  reason: string;
  ts: number;
}

export interface PathAccessAudit {
  client: ClientKind;
  records: PathAccessRecord[];
}

export type RawEventKind =
  | "user_message"
  | "assistant_message"
  | "tool_use"
  | "tool_result"
  | "file_change"
  | "system"
  | "progress"
  | "token"
  | "history_entry"
  | "composer"
  | "db_row"
  | "unknown";

export interface RawEvent {
  id: string;
  client: ClientKind;
  sourcePath: string;
  timestamp: number;
  kind: RawEventKind;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface TimelineEvent {
  id: string;
  client: ClientKind;
  ts: number;
  label: string;
  detail: string;
  actor: "user" | "assistant" | "system";
  tags: string[];
  sourcePath: string;
  metadata: Record<string, unknown>;
}

export interface TimeRange {
  start: number;
  end: number;
  label: string;
  source: "query" | "flag" | "default";
}

export interface QueryIntent {
  raw: string;
  normalized: string;
  language: "zh" | "en" | "mixed";
  type: "project_activity" | "daily_recap" | "history" | "generic";
  asksProject: boolean;
  asksAllProjects: boolean;
  projectHint?: string;
  timeRange: TimeRange;
}

export interface ProjectCandidate {
  id: string;
  name: string;
  root: string;
  client: ClientKind;
  signalScore: number;
  lastActiveAt: number;
  sources: string[];
}

export type ProjectScope =
  | {
      mode: "single";
      project: ProjectCandidate;
    }
  | {
      mode: "all";
      projects: ProjectCandidate[];
    };

export type EvidenceType =
  | "file_change"
  | "tool_call"
  | "tool_result"
  | "assistant_text"
  | "user_text"
  | "system";

export interface EvidenceItem {
  id: string;
  client: ClientKind;
  projectId?: string;
  ts: number;
  type: EvidenceType;
  sourcePath: string;
  summary: string;
  detail: string;
  confidence: number;
  priority: number;
  eventId?: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceConflict {
  id: string;
  winnerEvidenceId: string;
  discardedEvidenceIds: string[];
  reason: string;
  confidence: number;
}

export interface ActionChainStep {
  eventId: string;
  ts: number;
  label: string;
  detail: string;
  actor: TimelineEvent["actor"];
  evidenceIds: string[];
}

export interface ActionChain {
  id: string;
  majorEventId: string;
  projectId?: string;
  summary: string;
  confidence: number;
  steps: ActionChainStep[];
}

export interface PromptPreview {
  prompt: string;
  tokenEstimate: number;
  warnings: string[];
}

export interface UserInstruction {
  id: string;
  ts: number;
  text: string;
  normalized: string;
  tokens: string[];
  sourceEventId?: string;
}

export interface RepetitionCluster {
  id: string;
  topic: string;
  count: number;
  instructionIds: string[];
  kind: "exact_repeat" | "topic_repeat";
  interpretation: "feature_polish" | "stuck_issue" | "normal_iteration";
}

export interface FeatureDelta {
  id: string;
  area: string;
  files: string[];
  before: string;
  after: string;
  basis: string[];
  confidence: number;
}

export interface TimelineNarrativeSegment {
  id: string;
  start: number;
  end: number;
  title: string;
  summary: string;
  evidenceIds: string[];
}

export interface AnalysisInsights {
  instructions: UserInstruction[];
  repetition: RepetitionCluster[];
  featureDeltas: FeatureDelta[];
  timelineNarrative: TimelineNarrativeSegment[];
}

export interface ClientRunnerCapability {
  client: ClientKind;
  supported: boolean;
  command?: string;
  reason?: string;
}

export interface GenerationResult {
  supported: boolean;
  status: "ok" | "unsupported" | "failed" | "skipped";
  output: string;
  rawOutput?: string;
  error?: string;
}

export type MajorEventType =
  | "GOAL"
  | "ASSIST"
  | "PENALTY"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "CORNER"
  | "OFFSIDE"
  | "SUBSTITUTION";

export interface MajorEvent {
  id: string;
  client: ClientKind;
  ts: number;
  type: MajorEventType;
  title: string;
  summary: string;
  score: number;
  triggerEventId: string;
  followUpEventIds: string[];
  ruleId: string;
}

export interface ReplaySegment {
  eventId: string;
  before: TimelineEvent[];
  focus: MajorEvent;
  after: TimelineEvent[];
}

export interface RunContext {
  runId: string;
  client: ClientKind;
  startedAt: number;
  endedAt: number;
  sinceMs?: number;
  selectedBy: SelectionSource;
  dataRoots: string[];
  query?: QueryIntent;
  projectScope?: ProjectScope;
}

export interface LLMProviderConfig {
  provider: "openai" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
}

export interface EventRule {
  id: string;
  eventType: MajorEventType;
  anyOf: string[];
  allOf?: string[];
  not?: string[];
  minScore?: number;
  weight?: number;
}

export interface ClassifyOptions {
  rules: EventRule[];
  followUpWindow: number;
  followUpCount: number;
  llm?: LLMProviderConfig;
}

export interface DoctorCheck {
  ok: boolean;
  message: string;
  path?: string;
}

export interface ExportPayload {
  context: RunContext;
  query?: QueryIntent;
  projectScope?: ProjectScope;
  timeline: TimelineEvent[];
  majorEvents: MajorEvent[];
  actionChains: ActionChain[];
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  insights?: AnalysisInsights;
  promptPreview?: PromptPreview;
  generation?: GenerationResult;
  replay: ReplaySegment[];
  audit: PathAccessAudit;
}

export interface RunOutput {
  context: RunContext;
  query?: QueryIntent;
  projectScope?: ProjectScope;
  rawEvents: RawEvent[];
  timeline: TimelineEvent[];
  majorEvents: MajorEvent[];
  actionChains: ActionChain[];
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  insights?: AnalysisInsights;
  promptPreview?: PromptPreview;
  generation?: GenerationResult;
  replay: ReplaySegment[];
  audit: PathAccessAudit;
}
