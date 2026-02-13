import { createHash } from "node:crypto";

export function stableId(...parts: Array<string | number>): string {
  const text = parts.map((v) => String(v)).join("|");
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export function toTimestamp(value: unknown): number {
  if (typeof value === "number") {
    if (value > 1_000_000_000_000) return value;
    if (value > 1_000_000_000) return value * 1000;
    return Date.now();
  }

  if (typeof value === "string") {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return toTimestamp(asNum);
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

export function parseDurationToMs(input?: string): number | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([smhdw])$/);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  const unit = match[2];
  const table: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return value * table[unit];
}

export function formatDate(ts: number): string {
  return new Date(ts).toISOString();
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
