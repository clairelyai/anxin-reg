import { NextResponse } from "next/server";

type ParsedIntent = { intent: "register"; department: string; date: string; visitType: string };

// Keyword-based routing only — this maps common symptom wording to a
// department for convenience, it does NOT diagnose anything. Someone saying
// "眼睛紅腫癢" gets routed to 眼科 the same way someone saying "眼科" directly
// would; the mapping never reasons about severity or urgency.
function fallback(text: string): ParsedIntent {
  const department = /眼|目睭|看不清楚|視力|流眼油|畏光/.test(text) ? "眼科"
    : /皮膚|癢|疹子|濕疹|長痘/.test(text) ? "皮膚科"
    : /耳|鼻|喉|喉嚨痛|鼻塞|耳鳴/.test(text) ? "耳鼻喉科"
    : "眼科";
  const date = /三/.test(text) ? "next Wednesday" : /五/.test(text) ? "next Friday" : "next week";
  const visitType = /回診|複診|再來|上次/.test(text) ? "複診" : /初診|第一次|新病人/.test(text) ? "初診" : "未確定";
  return { intent: "register", department, date, visitType };
}

export async function POST(request: Request) {
  const { text } = await request.json() as { text?: string };
  if (!text || text.length > 300) return NextResponse.json({ error: "invalid_text" }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ intent: fallback(text), engine: "deterministic-fallback" });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.INTENT_MODEL || "gpt-4o-mini",
        input: [{ role: "system", content: "Extract a Taiwan hospital registration intent from what an elderly speaker said. They may name a department directly (\"眼科\") or describe a symptom (\"眼睛很癢看不清楚\", \"我要回診\") — in that case pick the single most likely department for routing purposes only; this is NOT a medical diagnosis, just which clinic to check in at. Also classify visitType as one of 初診 (first visit / new patient), 複診 (follow-up / repeat visit), or 未確定 (unclear) based on wording like 回診/複診 or 初診/第一次. Return only the requested schema. Convert relative dates to short English phrases such as next Wednesday." }, { role: "user", content: text }],
        text: { format: { type: "json_schema", name: "registration_intent", strict: true, schema: { type: "object", additionalProperties: false, properties: { intent: { type: "string", enum: ["register"] }, department: { type: "string" }, date: { type: "string" }, visitType: { type: "string", enum: ["初診", "複診", "未確定"] } }, required: ["intent", "department", "date", "visitType"] } } },
      }),
    });
    if (!response.ok) throw new Error("openai_intent_failed");
    const result = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("empty_intent");
    return NextResponse.json({ intent: JSON.parse(outputText), engine: "openai" });
  } catch {
    return NextResponse.json({ intent: fallback(text), engine: "deterministic-fallback" });
  }
}
