import type { QueryIntent, TimeRange } from "../../shared-types/src";

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function detectLanguage(text: string): QueryIntent["language"] {
  const hasCJK = /[\u4e00-\u9fff]/.test(text);
  const hasLatin = /[a-z]/i.test(text);
  if (hasCJK && hasLatin) return "mixed";
  if (hasCJK) return "zh";
  return "en";
}

function resolveTimeRange(normalized: string, now: number): TimeRange {
  const dayMs = 24 * 60 * 60 * 1000;

  if (/(昨天|yesterday)/.test(normalized)) {
    const todayStart = startOfDay(now);
    return {
      start: todayStart - dayMs,
      end: todayStart - 1,
      label: "yesterday",
      source: "query",
    };
  }

  if (/(最近三天|近三天|过去三天|last\s*3\s*days|past\s*3\s*days|recent\s*3\s*days)/.test(normalized)) {
    return {
      start: now - dayMs * 3,
      end: now,
      label: "last_3_days",
      source: "query",
    };
  }

  if (/(今天|today)/.test(normalized)) {
    return {
      start: startOfDay(now),
      end: now,
      label: "today",
      source: "query",
    };
  }

  if (/(最近一天|过去一天|last\s*day|past\s*day|last\s*24\s*hours|past\s*24\s*hours)/.test(normalized)) {
    return {
      start: now - dayMs,
      end: now,
      label: "last_24h",
      source: "query",
    };
  }

  return {
    start: now - dayMs,
    end: now,
    label: "default_last_24h",
    source: "default",
  };
}

function extractProjectHint(question: string, normalized: string): string | undefined {
  const zhMatch = question.match(/对[“"'`]?([A-Za-z0-9._/-]+)[”"'`]?项目/);
  if (zhMatch?.[1]) return zhMatch[1];

  const zhInMatch = question.match(/在[“"'`]?([A-Za-z0-9._/-]{2,})[”"'`]?(?:项目|工程|仓库|repo|里|中)?/);
  if (zhInMatch?.[1]) return zhInMatch[1];

  const enMatch = question.match(/(?:on|for)\s+["'`]?([A-Za-z0-9._/-]+)["'`]?\s*(?:project|repo|folder)?/i);
  if (enMatch?.[1]) return enMatch[1];

  const enInMatch = question.match(/in\s+["'`]?([A-Za-z0-9._/-]{2,})["'`]?\s*(?:project|repo|folder|workspace)?/i);
  if (enInMatch?.[1]) return enInMatch[1];

  const quoteMatch = question.match(/[“"'`]([A-Za-z0-9._/-]{2,})[”"'`]/);
  if (quoteMatch?.[1]) return quoteMatch[1];

  return undefined;
}

function inferType(normalized: string): QueryIntent["type"] {
  if (/(做了什么|干嘛了|what\s+did\s+i\s+do|what\s+did\s+we\s+do)/.test(normalized)) {
    return "project_activity";
  }
  if (/(回顾|总结|recap|summary|daily)/.test(normalized)) {
    return "daily_recap";
  }
  if (/(成长史|历史|timeline|history)/.test(normalized)) {
    return "history";
  }
  return "generic";
}

export function parseQuery(question: string, now = Date.now()): QueryIntent {
  const normalized = question.trim().toLowerCase();
  const timeRange = resolveTimeRange(normalized, now);
  const projectHint = extractProjectHint(question, normalized);
  const asksAllProjects = /(所有项目|全部项目|哪些项目|什么项目|哪几个项目|all projects|all repos|all folders|which projects|what projects)/.test(
    normalized,
  );
  const asksProject =
    asksAllProjects ||
    Boolean(projectHint) ||
    /(项目|repo|repository|folder|workspace)/.test(normalized) ||
    inferType(normalized) === "project_activity";

  return {
    raw: question,
    normalized,
    language: detectLanguage(question),
    type: inferType(normalized),
    asksProject,
    asksAllProjects,
    projectHint,
    timeRange,
  };
}
