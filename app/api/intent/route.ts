import { NextResponse } from "next/server";

type ParsedIntent = { intent: "register"; department: string; date: string };

function fallback(text: string): ParsedIntent {
  const department = /眼|目睭/.test(text) ? "眼科" : /皮膚/.test(text) ? "皮膚科" : /耳|鼻|喉/.test(text) ? "耳鼻喉科" : "眼科";
  const date = /三/.test(text) ? "next Wednesday" : /五/.test(text) ? "next Friday" : "next week";
  return { intent: "register", department, date };
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
        input: [{ role: "system", content: "Extract a Taiwan hospital registration intent. Return only the requested schema. Convert relative dates to short English phrases such as next Wednesday." }, { role: "user", content: text }],
        text: { format: { type: "json_schema", name: "registration_intent", strict: true, schema: { type: "object", additionalProperties: false, properties: { intent: { type: "string", enum: ["register"] }, department: { type: "string" }, date: { type: "string" } }, required: ["intent", "department", "date"] } } },
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
