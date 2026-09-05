import { NextResponse } from "next/server";

// Taipei Chang Gung (台北長庚), Ophthalmology (眼科). Campus id "1" and this
// exact department code string were confirmed by hand from the live public
// schedule page on 2026-09-05. If CGMH changes the page structure, parsing
// below fails closed to the demo data further down — nothing here ever
// submits a booking or touches patient data.
const SOURCE_URL =
  "https://register.cgmh.org.tw/Department_WEEK/1/13400A13410A13420A13430A13440A13450A13460A13470A13480A13490A";
const HOSPITAL = "台北長庚紀念醫院";
const DEPARTMENT = "眼科";
const SESSION_NAMES = ["上午", "下午", "晚上"] as const;
const MAX_SLOTS = 6;

type Doctor = {
  code: string;
  name: string;
  full: boolean;
  suspended: boolean;
  firstVisitOk: boolean;
  bookable: boolean;
  href: string;
};

type ScheduleRow = {
  date: string | null;
  weekday: string;
  sessions: { session: string; doctors: Doctor[] }[];
};

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, "").trim();
}

// "09/09（三）" -> { date: "2026-09-09", weekday: "禮拜三" }. CGMH's table never
// prints the year, so it's inferred from "today" and rolled forward a year if
// the parsed month looks far in the past (reading the page right after New
// Year's, when the table still shows some trailing December rows).
function parseDateLabel(label: string, today: Date): { date: string | null; weekday: string } {
  const m = label.match(/(\d{2})\/(\d{2})[（(](.)[)）]/);
  if (!m) return { date: null, weekday: "" };
  const [, mm, dd, wd] = m;
  const weekdayMap: Record<string, string> = { 一: "禮拜一", 二: "禮拜二", 三: "禮拜三", 四: "禮拜四", 五: "禮拜五", 六: "禮拜六", 日: "禮拜日" };
  let year = today.getFullYear();
  const month = Number(mm);
  if (month < today.getMonth() + 1 - 6) year += 1;
  return { date: `${year}-${mm}-${dd}`, weekday: weekdayMap[wd] || "" };
}

function parseDoctors(cellHtml: string): Doctor[] {
  const doctors: Doctor[] = [];
  // CGMH leaves commented-out example rows (<!-- ... -->) inside each cell;
  // strip them first or they get parsed as if they were real entries.
  const withoutComments = cellHtml.replace(/<!--[\s\S]*?-->/g, "");
  const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = aRegex.exec(withoutComments))) {
    const attrs = m[1];
    const href = attrs.match(/href="([^"]*)"/)?.[1] || "";
    const text = stripTags(m[2]);
    const idMatch = text.match(/^(\d+)\s*(.*)$/);
    if (!idMatch) continue;
    const rest = idMatch[2];
    doctors.push({
      code: idMatch[1],
      name: rest.replace(/[(（][^)）]*[)）]/g, "").replace(/科初診可掛/, "").trim(),
      full: /額滿/.test(rest),
      suspended: /停診/.test(rest),
      firstVisitOk: /科初診可掛/.test(rest),
      bookable: href.startsWith("/Checkin/"),
      href,
    });
  }
  return doctors;
}

function parseSchedule(html: string, today: Date): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const trRegex = /<tr[^>]*>\s*<th>([^<]*)<\/th>([\s\S]*?)<\/tr>/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html))) {
    const { date, weekday } = parseDateLabel(trMatch[1].trim(), today);
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const sessions: ScheduleRow["sessions"] = [];
    let tdMatch: RegExpExecArray | null;
    let i = 0;
    while ((tdMatch = tdRegex.exec(trMatch[2]))) {
      sessions.push({ session: SESSION_NAMES[i] || `時段${i + 1}`, doctors: parseDoctors(tdMatch[1]) });
      i++;
    }
    rows.push({ date, weekday, sessions });
  }
  return rows;
}

function buildLiveSlots(rows: ScheduleRow[], today: Date) {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const slots: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (!row.date) continue;
    const rowDate = new Date(`${row.date}T00:00:00`);
    if (rowDate < startOfToday) continue;
    for (const session of row.sessions) {
      const pick = session.doctors.find((d) => d.bookable && !d.suspended);
      if (!pick) continue;
      slots.push({
        value: `${row.date}-${session.session}`,
        date: row.date,
        displayDate: `${Number(row.date.slice(5, 7))} 月 ${Number(row.date.slice(8, 10))} 日`,
        weekday: row.weekday,
        period: session.session,
        doctor: pick.name,
        time: session.session,
        status: pick.full && pick.firstVisitOk ? "一般額滿，初診可掛" : pick.full ? "額滿" : pick.firstVisitOk ? "初診可掛" : "可掛號",
        // Deep link straight to this doctor/date/session's real Checkin page,
        // so the handoff step can send the family member exactly where they
        // need to be instead of just the department's schedule page. We never
        // fetch or POST to this URL ourselves — only display it as a link.
        checkinUrl: new URL(pick.href, "https://register.cgmh.org.tw").toString(),
      });
      if (slots.length >= MAX_SLOTS) return slots;
    }
  }
  return slots;
}

function nextWeekday(target: number) {
  const date = new Date();
  const delta = (target - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

function demoSlots() {
  const slot = (date: Date, weekday: string, period: string, doctor: string, status: string) => ({
    value: `${date.toISOString().slice(0, 10)}-${period}`,
    date: date.toISOString().slice(0, 10),
    displayDate: `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`,
    weekday,
    period,
    doctor,
    time: period,
    status,
  });
  return [
    slot(nextWeekday(3), "禮拜三", "下午", "示範醫師 A", "示範資料"),
    slot(nextWeekday(5), "禮拜五", "上午", "示範醫師 B", "示範資料"),
  ];
}

// A single fetch to register.cgmh.org.tw occasionally times out or hiccups
// for reasons that have nothing to do with our parsing (their server is just
// slow to respond sometimes). Retrying a couple of times before giving up on
// live data noticeably cuts down how often the UI falls back to demo slots
// for no real reason — this is still fail-safe: any attempt that succeeds
// wins, and only total failure across every attempt falls through to demo.
async function fetchScheduleHtml(attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(SOURCE_URL, {
        headers: { accept: "text/html", "user-agent": "AnxinRegistrationDemo/1.0 (read-only hackathon prototype)" },
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) return await response.text();
    } catch {
      /* network failure or timeout on this attempt: try again below, or fall through to demo data after the last attempt */
    }
  }
  return null;
}

export async function GET() {
  let sourceReachable = false;
  let liveSlots: Array<Record<string, unknown>> = [];

  const html = await fetchScheduleHtml();
  if (html) {
    sourceReachable = /長庚醫療財團法人|CHANG GUNG/i.test(html);
    liveSlots = buildLiveSlots(parseSchedule(html, new Date()), new Date());
  }

  const live = liveSlots.length > 0;

  return NextResponse.json({
    hospital: HOSPITAL,
    department: DEPARTMENT,
    sourceUrl: SOURCE_URL,
    sourceMode: live ? "live" : "demo",
    sourceReachable,
    slots: live ? liveSlots : demoSlots(),
    fetchedAt: new Date().toISOString(),
    disclaimer:
      "本頁僅唯讀擷取長庚公開網路掛號頁面之班表資訊，非官方即時保證，實際掛號結果請以長庚官網為準；本系統不會自動送出掛號。",
  });
}
