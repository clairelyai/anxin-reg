import { NextResponse } from "next/server";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
};

async function verifySignature(secret: string, body: string, signature: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return computed === signature;
}

// Only used to help set up the demo: whoever messages or adds the bot gets
// their own LINE userId echoed back so it can be copied into
// LINE_FAMILY_USER_ID. No message content is stored or logged beyond the
// platform's own request logs.
export async function POST(request: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const rawBody = await request.text();

  if (secret) {
    const signature = request.headers.get("x-line-signature") || "";
    const valid = await verifySignature(secret, rawBody, signature).catch(() => false);
    if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  console.log("line_webhook_hit", { hasToken: !!token, hasSecret: !!secret, eventCount: payload.events?.length ?? 0 });

  if (token) {
    for (const event of payload.events || []) {
      console.log("line_webhook_event", { type: event.type, hasReplyToken: !!event.replyToken, userId: event.source?.userId });
      const userId = event.source?.userId;
      if (!event.replyToken || !userId) continue;
      const text =
        event.type === "follow"
          ? `已加入好友。這是您的 LINE 使用者代碼(僅供安心掛號 Demo 設定使用):\n${userId}\n\n請把這串代碼提供給設定通知的人，填入 LINE_FAMILY_USER_ID 才能收到自動通知。`
          : `您的 LINE 使用者代碼:\n${userId}`;
      try {
        const replyResponse = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: "text", text }] }),
        });
        if (!replyResponse.ok) {
          console.log("line_reply_failed", replyResponse.status, await replyResponse.text());
        } else {
          console.log("line_reply_sent_ok");
        }
      } catch (err) {
        console.log("line_reply_error", String(err));
      }
    }
  } else {
    console.log("line_webhook_no_token_configured");
  }

  return NextResponse.json({ ok: true });
}
