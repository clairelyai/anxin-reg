import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "stt_not_configured" }, { status: 503 });
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0 || audio.size > 12_000_000) return NextResponse.json({ error: "invalid_audio" }, { status: 400 });

  const form = new FormData();
  form.append("file", audio, audio.name || "speech.webm");
  form.append("model", process.env.TRANSCRIPTION_MODEL || "whisper-1");
  form.append("language", "zh");
  form.append("prompt", "台灣醫院掛號、長庚、科別、日期、眼科、皮膚科、耳鼻喉科");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
    if (!response.ok) return NextResponse.json({ error: "transcription_failed" }, { status: 502 });
    const result = await response.json() as { text?: string };
    if (!result.text) return NextResponse.json({ error: "empty_transcript" }, { status: 502 });
    return NextResponse.json({ text: result.text, engine: "whisper-1" });
  } catch {
    return NextResponse.json({ error: "transcription_unavailable" }, { status: 503 });
  }
}
