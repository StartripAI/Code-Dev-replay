import { spawnSync } from "node:child_process";
import type {
  ClientKind,
  ClientRunnerCapability,
  GenerationResult,
  PathAccessAudit,
  ProjectScope,
} from "../../shared-types/src";
import { recordAudit } from "../../core/src";

interface RunnerSpec {
  bin: string;
  args: (prompt: string, scope: ProjectScope) => string[];
  supported: boolean;
  reason?: string;
}

function codexModel(): string {
  return process.env.WDYD_CODEX_MODEL?.trim() || "gpt-5";
}

function codexReasoningEffort(): string {
  return process.env.WDYD_CODEX_REASONING_EFFORT?.trim() || "high";
}

function truncateOutput(text: string, max = 2400, keepTail = false): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (keepTail) {
    return `...${trimmed.slice(-(max - 3))}`;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}

const RUNNERS: Record<ClientKind, RunnerSpec> = {
  codex: {
    bin: "codex",
    args: (prompt, scope) => [
      "exec",
      "--skip-git-repo-check",
      "-C",
      scope.mode === "single" ? scope.project.root : process.cwd(),
      "-m",
      codexModel(),
      "-c",
      `model_reasoning_effort=${JSON.stringify(codexReasoningEffort())}`,
      prompt,
    ],
    supported: true,
  },
  claude: {
    bin: "claude",
    args: (prompt) => ["--print", prompt],
    supported: true,
  },
  cursor: {
    bin: "code",
    args: (prompt, scope) => ["agent", "--print", "--output-format", "text", "--workspace", scope.mode === "single" ? scope.project.root : process.cwd(), prompt],
    supported: true,
  },
  opencode: {
    bin: "opencode",
    args: (prompt) => ["run", "--format", "default", prompt],
    supported: true,
  },
  vscode: {
    bin: "code",
    args: () => [],
    supported: false,
    reason: "vscode has no stable machine-readable chat output channel",
  },
  antigravity: {
    bin: "antigravity",
    args: () => [],
    supported: false,
    reason: "antigravity has no stable machine-readable chat output channel",
  },
};

function hasBinary(bin: string): boolean {
  const result = spawnSync("which", [bin], { encoding: "utf-8" });
  return result.status === 0;
}

export function getRunnerCapability(client: ClientKind): ClientRunnerCapability {
  const spec = RUNNERS[client];
  if (!spec.supported) {
    return {
      client,
      supported: false,
      command: spec.bin,
      reason: spec.reason,
    };
  }
  return {
    client,
    supported: hasBinary(spec.bin),
    command: spec.bin,
    reason: hasBinary(spec.bin) ? undefined : `${spec.bin} not found on PATH`,
  };
}

export function runClientLLM(
  client: ClientKind,
  prompt: string,
  scope: ProjectScope,
  audit?: PathAccessAudit,
): GenerationResult {
  const spec = RUNNERS[client];
  if (!spec.supported) {
    return {
      supported: false,
      status: "unsupported",
      output: "",
      error: spec.reason,
    };
  }

  if (!hasBinary(spec.bin)) {
    return {
      supported: false,
      status: "failed",
      output: "",
      error: `${spec.bin} not found on PATH`,
    };
  }

  const args = spec.args(prompt, scope);
  if (audit) {
    recordAudit(audit, `${spec.bin} ${args.join(" ")}`, "runner", true, "runner invocation");
  }
  const result = spawnSync(spec.bin, args, {
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();

  if (result.error) {
    return {
      supported: true,
      status: "failed",
      output: "",
      rawOutput: truncateOutput(stdout || stderr, 4000, true),
      error: truncateOutput(result.error.message, 300, true),
    };
  }

  if (result.status !== 0) {
    return {
      supported: true,
      status: "failed",
      output: "",
      rawOutput: truncateOutput(stdout || stderr, 4000, true),
      error: truncateOutput(stderr || `runner exited with status ${result.status}`, 400, true),
    };
  }

  return {
    supported: true,
    status: "ok",
    output: truncateOutput(stdout || stderr, 8000),
    rawOutput: truncateOutput([stdout, stderr].filter(Boolean).join("\n"), 10_000),
  };
}
