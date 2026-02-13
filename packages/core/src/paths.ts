import { existsSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import type { ClientKind, ClientPaths, PathAccessAudit, PathAccessRecord } from "../../shared-types/src";
import { uniq } from "./utils";

const MAC = "darwin";
const WIN = "win32";

function expandHome(value: string): string {
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function osPathSet(client: ClientKind): { roots: string[]; globs: string[] } {
  const home = homedir();
  switch (client) {
    case "claude":
      return {
        roots: [join(home, ".claude")],
        globs: [
          join(home, ".claude", "projects", "**", "*.jsonl"),
          join(home, ".claude", "history.jsonl"),
        ],
      };
    case "codex":
      return {
        roots: [join(home, ".codex")],
        globs: [
          join(home, ".codex", ".codex-global-state.json"),
          join(home, ".codex", "sessions", "**", "*.jsonl"),
          join(home, ".codex", "archived_sessions", "*.jsonl"),
          join(home, ".codex", "history.jsonl"),
          join(home, ".codex", "sqlite", "*.db"),
          join(home, ".codex", "sqlite", "*.sqlite"),
        ],
      };
    case "cursor": {
      const cursorRoot =
        process.platform === MAC
          ? join(home, "Library", "Application Support", "Cursor")
          : process.platform === WIN
            ? join(home, "AppData", "Roaming", "Cursor")
            : join(home, ".config", "Cursor");
      return {
        roots: [join(home, ".cursor"), cursorRoot],
        globs: [
          join(home, ".cursor", "ai-tracking", "*.db"),
          join(cursorRoot, "User", "globalStorage", "state.vscdb"),
          join(cursorRoot, "User", "workspaceStorage", "*", "workspace.json"),
          join(cursorRoot, "User", "workspaceStorage", "*", "state.vscdb"),
          join(cursorRoot, "User", "History", "*", "entries.json"),
        ],
      };
    }
    case "vscode": {
      const codeRoot =
        process.platform === MAC
          ? join(home, "Library", "Application Support", "Code")
          : process.platform === WIN
            ? join(home, "AppData", "Roaming", "Code")
            : join(home, ".config", "Code");
      return {
        roots: [codeRoot],
        globs: [
          join(codeRoot, "User", "globalStorage", "state.vscdb"),
          join(codeRoot, "User", "workspaceStorage", "*", "workspace.json"),
          join(codeRoot, "User", "workspaceStorage", "*", "state.vscdb"),
          join(codeRoot, "User", "History", "*", "entries.json"),
        ],
      };
    }
    case "antigravity": {
      const agRoot =
        process.platform === MAC
          ? join(home, "Library", "Application Support", "Antigravity")
          : process.platform === WIN
            ? join(home, "AppData", "Roaming", "Antigravity")
            : join(home, ".config", "Antigravity");
      return {
        roots: [join(home, ".antigravity"), agRoot],
        globs: [
          join(agRoot, "User", "globalStorage", "state.vscdb"),
          join(agRoot, "User", "workspaceStorage", "*", "workspace.json"),
          join(agRoot, "User", "workspaceStorage", "*", "state.vscdb"),
          join(agRoot, "User", "History", "*", "entries.json"),
          join(home, ".antigravity", "**", "*.jsonl"),
        ],
      };
    }
    case "opencode": {
      const envOverride = process.env.WDYD_OPENCODE_PATH;
      const xdgData = process.env.XDG_DATA_HOME;
      const defaultRoot = envOverride ? expandHome(envOverride) : join(xdgData ?? join(home, ".local", "share"), "opencode");
      return {
        roots: [defaultRoot],
        globs: [
          join(defaultRoot, "storage", "project", "**", "*.json"),
          join(defaultRoot, "storage", "session", "**", "*.json"),
          join(defaultRoot, "storage", "message", "**", "*.json"),
          join(defaultRoot, "storage", "part", "**", "*.json"),
          join(defaultRoot, "**", "*.db"),
          join(defaultRoot, "**", "*.sqlite"),
        ],
      };
    }
    default:
      return { roots: [], globs: [] };
  }
}

export function createAudit(client: ClientKind): PathAccessAudit {
  return { client, records: [] };
}

export function recordAudit(
  audit: PathAccessAudit,
  path: string,
  action: PathAccessRecord["action"],
  allowed: boolean,
  reason: string,
): void {
  audit.records.push({
    path,
    action,
    allowed,
    reason,
    ts: Date.now(),
  });
}

export function assertPathAllowed(
  filePath: string,
  allowedRoots: string[],
  audit: PathAccessAudit,
  action: PathAccessRecord["action"],
): void {
  const resolved = normalize(resolve(filePath));
  const allowed = allowedRoots.some((root) => {
    const normalizedRoot = normalize(resolve(root));
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${process.platform === WIN ? "\\" : "/"}`);
  });

  if (!allowed) {
    recordAudit(audit, resolved, action, false, "outside client whitelist");
    throw new Error(`Path blocked by whitelist: ${resolved}`);
  }

  recordAudit(audit, resolved, action, true, "within client whitelist");
}

export function resolvePaths(client: ClientKind, audit: PathAccessAudit): ClientPaths {
  const config = osPathSet(client);
  const roots = uniq(config.roots.map(expandHome).map((p) => normalize(resolve(p))));
  return resolvePathsWithExtraRoots(client, audit, roots);
}

export function resolvePathsWithExtraRoots(
  client: ClientKind,
  audit: PathAccessAudit,
  extraRoots: string[] = [],
): ClientPaths {
  const config = osPathSet(client);
  const roots = uniq([
    ...config.roots.map(expandHome).map((p) => normalize(resolve(p))),
    ...extraRoots.map((p) => normalize(resolve(p))),
  ]);
  const files: string[] = [];

  for (const pattern of config.globs) {
    const expanded = expandHome(pattern);
    const rootPart = expanded.split("**")[0].split("*")[0];
    if (rootPart) {
      assertPathAllowed(rootPart, roots, audit, "glob");
    }

    const matches = globSync(expanded);
    for (const match of matches) {
      if (existsSync(match)) {
        assertPathAllowed(match, roots, audit, "read");
        files.push(normalize(resolve(match)));
      }
    }
  }

  return {
    client,
    roots,
    files: uniq(files),
    globs: config.globs,
  };
}
