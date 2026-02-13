import type { LLMProviderConfig, MajorEvent, TimelineEvent } from "../../shared-types/src";

interface LLMMessage {
  role: "system" | "user";
  content: string;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  return res.json();
}

async function summarizeWithOpenAI(config: LLMProviderConfig, messages: LLMMessage[]): Promise<string> {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const result = (await postJson(
    `${baseUrl}/chat/completions`,
    {
      model: config.model,
      messages,
      temperature: 0.2,
    },
    { Authorization: `Bearer ${config.apiKey}` },
  )) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return result.choices?.[0]?.message?.content?.trim() ?? "";
}

async function summarizeWithAnthropic(config: LLMProviderConfig, messages: LLMMessage[]): Promise<string> {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
  const joined = messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  const result = (await postJson(
    `${baseUrl}/messages`,
    {
      model: config.model,
      max_tokens: 300,
      temperature: 0.2,
      messages: [{ role: "user", content: joined }],
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
      "anthropic-version": "2023-06-01",
    },
  )) as {
    content?: Array<{ text?: string }>;
  };

  return result.content?.[0]?.text?.trim() ?? "";
}

async function summarizeWithGoogle(config: LLMProviderConfig, messages: LLMMessage[]): Promise<string> {
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const prompt = messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  const result = (await postJson(
    `${baseUrl}/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    },
    {},
  )) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

export async function summarizeMajorEventWithLLM(args: {
  config: LLMProviderConfig;
  major: MajorEvent;
  timeline: TimelineEvent[];
}): Promise<string> {
  const { config, major, timeline } = args;
  if (!config.enabled || !config.apiKey) {
    return "";
  }

  const focus = timeline.find((x) => x.id === major.triggerEventId);
  const followups = timeline.filter((x) => major.followUpEventIds.includes(x.id)).slice(0, 6);

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You summarize coding-session incidents as short sports-commentary headlines. Keep it factual, one sentence, <= 28 words.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          eventType: major.type,
          eventTitle: major.title,
          eventSummary: major.summary,
          trigger: focus,
          followups,
        },
        null,
        2,
      ),
    },
  ];

  if (config.provider === "openai") return summarizeWithOpenAI(config, messages);
  if (config.provider === "anthropic") return summarizeWithAnthropic(config, messages);
  return summarizeWithGoogle(config, messages);
}
