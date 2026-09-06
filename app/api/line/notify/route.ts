import { NextResponse } from "next/server";

// LINE_FAMILY_USER_ID can hold one userId, or several separated by commas
// (e.g. "Uabc...,Udef...") to notify more than one family member. This is a
// simple stand-in for a real per-user recipient list — see README for the
// tradeoffs — but it's enough to fan a push out to a handful of people.
function parseRecipients(raw: string): string[] {
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

export async function POST(request: Request) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const familyUserId = process.env.LINE_FAMILY_USER_ID;
  if (!token || !familyUserId) return NextResponse.json({ error: "line_not_configured" }, { status: 503 });
  const recipients = parseRecipients(familyUserId);
  if (recipients.length === 0) return NextResponse.json({ error: "line_not_configured" }, { status: 503 });

  const { text } = (await request.json()) as { text?: string };
  if (!text || text.length > 1000) return NextResponse.json({ error: "invalid_text" }, { status: 400 });

  const results = await Promise.all(recipients.map(async (to) => {
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }));

  const sentCount = results.filter(Boolean).length;
  if (sentCount === 0) return NextResponse.json({ error: "line_push_failed" }, { status: 502 });
  return NextResponse.json({ ok: true, sent: sentCount, total: recipients.length });
}
