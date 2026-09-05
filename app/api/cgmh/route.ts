import { NextResponse } from "next/server";

const SOURCE_URL = "https://register.cgmh.org.tw/en/Register/1";

function nextWeekday(target: number) {
  const date = new Date();
  const delta = ((target - date.getUTCDay() + 7) % 7 || 7);
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

function slot(date: Date, weekday: string, period: string, doctor: string, time: string, remaining: number) {
  return { value: `${date.toISOString().slice(0,10)}-${period}`, date: date.toISOString().slice(0,10), displayDate: `${date.getUTCMonth()+1} 月 ${date.getUTCDate()} 日`, weekday, period, doctor, time, remaining };
}

export async function GET() {
  let sourceReachable = false;
  try {
    const response = await fetch(SOURCE_URL, { headers: { accept: "text/html", "user-agent": "AnxinRegistrationDemo/1.0 (read-only hackathon prototype)" }, signal: AbortSignal.timeout(4500) });
    const html = response.ok ? await response.text() : "";
    if (/長庚醫療財團法人|CHANG GUNG/i.test(html) && /ophthalmology|眼科/i.test(html)) sourceReachable = true;
  } catch { /* keep a stable demo snapshot when the public site is slow or blocks server fetches */ }

  return NextResponse.json({
    hospital: "林口長庚紀念醫院",
    department: "眼科",
    sourceUrl: SOURCE_URL,
    sourceMode: "demo",
    sourceReachable,
    slots: [slot(nextWeekday(3), "禮拜三", "下午", "示範醫師 A", "下午 2:00", 3), slot(nextWeekday(5), "禮拜五", "早上", "示範醫師 B", "上午 9:30", 8)],
    fetchedAt: new Date().toISOString(),
    disclaimer: "Only public registration pages are read. No patient data is sent to CGMH.",
  });
}
