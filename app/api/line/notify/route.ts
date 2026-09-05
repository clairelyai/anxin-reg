import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const familyUserId = process.env.LINE_FAMILY_USER_ID;
  if (!token || !familyUserId) return NextResponse.json({ error: "line_not_configured" }, { status: 503 });

  const { text } = (await request.json()) as { text?: string };
  if (!text || text.length > 1000) return NextResponse.json({ error: "invalid_text" }, { status: 400 });

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to: familyUserId, messages: [{ type: "text", text }] }),
    });
    if (!response.ok) return NextResponse.json({ error: "line_push_failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "line_push_unavailable" }, { status: 503 });
  }
}
