import { spawnSync } from "node:child_process";
import { CLIENT_KINDS, type ClientKind, type DetectedClient } from "../../shared-types/src";

export interface DetectOptions {
  forcedClient?: ClientKind;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  cwd?: string;
  parentCommand?: string;
}

const CLIENT_HINTS: Record<ClientKind, string[]> = {
  claude: ["claude", "claude code", "anthropic"],
  codex: ["codex", "openai/codex"],
  cursor: ["cursor", "anysphere"],
  vscode: ["vscode", "visual studio code"],
  antigravity: ["antigravity"],
  opencode: ["opencode"],
};

export function isClientKind(value: string): value is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(value);
}

function readParentCommand(): string {
  const parentPid = process.ppid;
  if (!parentPid) return "";

  const command = spawnSync("ps", ["-o", "command=", "-p", String(parentPid)], {
    encoding: "utf-8",
  });

  if (command.status !== 0) {
    return "";
  }

  return command.stdout.trim().toLowerCase();
}

function scoreFromHints(text: string): Map<ClientKind, number> {
  const scores = new Map<ClientKind, number>();
  if (!text) return scores;

  for (const client of CLIENT_KINDS) {
    const matches = CLIENT_HINTS[client].filter((hint) => text.includes(hint));
    if (matches.length > 0) {
      scores.set(client, matches.length);
    }
  }

  return scores;
}

function mergeScores(target: Map<ClientKind, number>, input: Map<ClientKind, number>, weight: number): void {
  for (const [client, score] of input.entries()) {
    target.set(client, (target.get(client) ?? 0) + score * weight);
  }
}

export function detectClient(options: DetectOptions = {}): DetectedClient {
  const env = options.env ?? process.env;
  const argv = (options.argv ?? process.argv).join(" ").toLowerCase();
  const cwd = (options.cwd ?? process.cwd()).toLowerCase();

  if (options.forcedClient) {
    return {
      client: options.forcedClient,
      confidence: 1,
      reason: `forced by --client=${options.forcedClient}`,
      selectedBy: "flag",
      candidates: [options.forcedClient],
    };
  }

  const envClient = env.WDYD_CLIENT?.trim().toLowerCase();
  if (envClient && isClientKind(envClient)) {
    return {
      client: envClient,
      confidence: 1,
      reason: "selected by WDYD_CLIENT",
      selectedBy: "env",
      candidates: [envClient],
    };
  }

  const parentCommand = (options.parentCommand ?? readParentCommand()).toLowerCase();
  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();

  // Hard signals first: deterministic and high-confidence.
  const bundleIdentifier = String(env.__CFBundleIdentifier ?? "").toLowerCase();
  if (env.CODEX_SHELL === "1" || bundleIdentifier === "com.openai.codex" || String(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? "").toLowerCase().includes("codex")) {
    return {
      client: "codex",
      confidence: 1,
      reason: "detected from codex runtime env",
      selectedBy: "auto",
      candidates: ["codex"],
    };
  }

  if (parentCommand.includes("antigravity") && !parentCommand.includes("cursor") && !parentCommand.includes("codex")) {
    return {
      client: "antigravity",
      confidence: 0.99,
      reason: "detected from parent command",
      selectedBy: "auto",
      candidates: ["antigravity"],
    };
  }

  if ((parentCommand.includes("cursor") || argv.includes("cursor agent") || argv.includes("cursor chat")) && !parentCommand.includes("codex")) {
    return {
      client: "cursor",
      confidence: 0.99,
      reason: "detected from cursor command fingerprint",
      selectedBy: "auto",
      candidates: ["cursor"],
    };
  }

  if (parentCommand.includes("claude") && !parentCommand.includes("codex") && !parentCommand.includes("cursor")) {
    return {
      client: "claude",
      confidence: 0.99,
      reason: "detected from claude command fingerprint",
      selectedBy: "auto",
      candidates: ["claude"],
    };
  }

  if ((parentCommand.includes(" opencode") || parentCommand.startsWith("opencode")) && !parentCommand.includes("codex")) {
    return {
      client: "opencode",
      confidence: 0.99,
      reason: "detected from opencode command fingerprint",
      selectedBy: "auto",
      candidates: ["opencode"],
    };
  }

  if ((parentCommand.includes("/bin/code") || parentCommand.startsWith("code ")) && !parentCommand.includes("cursor")) {
    return {
      client: "vscode",
      confidence: 0.9,
      reason: "detected from code cli parent command",
      selectedBy: "auto",
      candidates: ["vscode"],
    };
  }

  const scores = new Map<ClientKind, number>();

  mergeScores(scores, scoreFromHints(argv), 2);
  mergeScores(scores, scoreFromHints(parentCommand), 3);
  mergeScores(scores, scoreFromHints(termProgram), 1);
  mergeScores(scores, scoreFromHints(cwd), 1);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return {
      client: null,
      confidence: 0,
      reason: "no client hint found",
      selectedBy: "auto",
      candidates: [],
    };
  }

  const [winner, winnerScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  if (winnerScore === secondScore) {
    return {
      client: null,
      confidence: 0.5,
      reason: "ambiguous client hints",
      selectedBy: "auto",
      candidates: ranked.filter((r) => r[1] === winnerScore).map((r) => r[0]),
    };
  }

  return {
    client: winner,
    confidence: Math.min(1, winnerScore / (winnerScore + secondScore + 1)),
    reason: "detected from runtime hints",
    selectedBy: "auto",
    candidates: [winner],
  };
}
