"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Intent = { intent: "register"; department: string; date: string };
type Slot = { value: string; date: string; displayDate: string; weekday: string; period: string; doctor: string; time: string; status?: string; checkinUrl?: string };
type CgmhData = { hospital: string; department: string; slots: Slot[]; sourceUrl: string; sourceMode: "live" | "demo"; sourceReachable?: boolean };

const SITE_URL = "https://site-creator-vinext-starter.anxin-reg.workers.dev";
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function nextWeekday(target: number, extraWeeks = 0) {
  const date = new Date();
  const delta = ((target - date.getDay() + 7) % 7 || 7) + extraWeeks * 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function fallbackData(): CgmhData {
  const wed = nextWeekday(3);
  const fri = nextWeekday(5);
  const display = (d: Date) => `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return {
    hospital: "台北長庚紀念醫院",
    department: "眼科",
    sourceUrl: "https://register.cgmh.org.tw/",
    sourceMode: "demo",
    slots: [
      { value: "wed-pm", date: wed.toISOString().slice(0, 10), displayDate: display(wed), weekday: "禮拜三", period: "下午", doctor: "示範醫師 A", time: "下午 2:00", status: "示範資料" },
      { value: "fri-am", date: fri.toISOString().slice(0, 10), displayDate: display(fri), weekday: "禮拜五", period: "早上", doctor: "示範醫師 B", time: "上午 9:30", status: "示範資料" },
    ],
  };
}

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "禮拜一", tuesday: "禮拜二", wednesday: "禮拜三", thursday: "禮拜四",
  friday: "禮拜五", saturday: "禮拜六", sunday: "禮拜日",
};

// intent.date comes back as a short English phrase like "next Friday" (from
// the AI step) or "next Wednesday" (from the local fallback) — pull the
// weekday name out of it so we can (a) show a Chinese label matching what
// the user actually asked for instead of a hardcoded day, and (b)
// auto-highlight the matching slot below instead of always defaulting to
// the first one.
function weekdayLabelFromIntentDate(date: string): string | null {
  const match = date.toLowerCase().match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/);
  return match ? WEEKDAY_LABELS[match[0]] : null;
}

function localIntent(text: string): Intent {
  const department = /眼|目睭/.test(text) ? "眼科" : /皮膚/.test(text) ? "皮膚科" : /耳|鼻|喉/.test(text) ? "耳鼻喉科" : "眼科";
  const date = /三/.test(text) ? "next Wednesday" : /五/.test(text) ? "next Friday" : "next week";
  return { intent: "register", department, date };
}

export default function Home() {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [intent, setIntent] = useState<Intent>({ intent: "register", department: "眼科", date: "next Wednesday" });
  const [data, setData] = useState<CgmhData>(fallbackData);
  const [selected, setSelected] = useState(0);
  const [letter, setLetter] = useState("");
  const [digits, setDigits] = useState("");
  const [notifyStatus, setNotifyStatus] = useState("");
  const [notifySent, setNotifySent] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const browserTranscript = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/cgmh").then((r) => r.ok ? r.json() : Promise.reject()).then(setData).catch(() => {});
    return () => {
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const requestedWeekday = weekdayLabelFromIntentDate(intent.date);

  // Once we know which weekday the user actually asked for (from voice) and
  // the real schedule has loaded, jump the selection to the first slot on
  // that weekday instead of always leaving it on the first slot in the list.
  useEffect(() => {
    if (!requestedWeekday) return;
    const match = data.slots.findIndex((item) => item.weekday === requestedWeekday);
    if (match >= 0) setSelected(match);
  }, [data, requestedWeekday]);

  const slot = data.slots[selected] || data.slots[0];
  const idNumber = `${letter}${digits}`;
  const validId = /^[A-Z][0-9]{9}$/.test(idNumber);
  const masked = digits.length >= 5 ? `${letter}${digits.slice(0, 2)}${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}` : idNumber;
  const dateText = slot ? `${slot.displayDate} ${slot.weekday} ${slot.period}` : "下禮拜三 下午";
  const shareText = useMemo(() => encodeURIComponent([
    "家人的掛號資料已準備好",
    data.hospital,
    `${intent.department}｜${slot?.doctor || "待選醫師"}`,
    dateText,
    `查看掛號資訊：${SITE_URL}`,
    ...(slot?.checkinUrl ? [`前往長庚確認掛號：${slot.checkinUrl}`] : []),
    "（示範流程，尚未送出真實掛號）",
  ].join("\n")), [data.hospital, dateText, intent.department, slot]);

  // Copies the ID number to the device's own clipboard only when the user taps
  // this button — it never travels through a URL, LINE message, or our
  // backend. Purely a convenience so whoever fills in the real CGMH page
  // doesn't have to retype it there; it changes nothing about what we submit
  // or store (still nothing).
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(idNumber);
      setCopyStatus("已複製到剪貼簿，可以直接貼到長庚頁面");
    } catch {
      setCopyStatus("複製失敗，請回上一步查看您輸入的號碼");
    }
  };

  const notifyFamily = async () => {
    setNotifyStatus("正在通知家人…");
    try {
      const response = await fetch("/api/line/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: decodeURIComponent(shareText) }),
      });
      if (!response.ok) throw new Error("notify_failed");
      setNotifySent(true);
      setNotifyStatus("已自動通知家人的 LINE ✓");
    } catch {
      setNotifySent(false);
      setNotifyStatus("尚未設定自動通知，請用下方按鈕手動分享");
    }
  };

  const advance = (next = index + 1, delay = 550) => {
    setBusy(true);
    timer.current = setTimeout(() => { setIndex(Math.min(next, 5)); setBusy(false); }, delay);
  };

  const parseIntent = async (text: string) => {
    setVoiceStatus("正在理解您的需求…");
    try {
      const response = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("intent_failed");
      const result = await response.json();
      setIntent(result.intent);
    } catch { setIntent(localIntent(text)); }
    setVoiceStatus("");
    advance(1, 250);
  };

  const transcribe = async (audio: Blob) => {
    setVoiceStatus("正在把語音轉成文字…");
    try {
      const form = new FormData();
      form.append("audio", audio, `speech.${audio.type.includes("mp4") ? "m4a" : "webm"}`);
      const response = await fetch("/api/voice", { method: "POST", body: form });
      if (!response.ok) throw new Error("stt_unavailable");
      const result = await response.json();
      setTranscript(result.text);
      await parseIntent(result.text);
    } catch {
      const text = browserTranscript.current || "我要掛下禮拜三的眼科";
      setTranscript(text);
      await parseIntent(text);
    }
  };

  const startVoice = async () => {
    if (recording) return;
    browserTranscript.current = "";
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mediaRecorder = new MediaRecorder(media);
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const audio = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        media.getTracks().forEach((track) => track.stop());
        void transcribe(audio);
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setVoiceStatus("正在聽，放開就送出");

      const SpeechRecognition = (window as typeof window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = "zh-TW";
        recognition.continuous = true;
        recognition.onresult = (event: any) => { browserTranscript.current = Array.from(event.results).map((item: any) => item[0].transcript).join(""); };
        try { recognition.start(); } catch { /* API transcription remains primary */ }
      }
    } catch {
      setVoiceStatus("無法開啟麥克風，已使用示範語句");
      const text = "我要掛下禮拜三的眼科";
      setTranscript(text);
      setTimeout(() => void parseIntent(text), 550);
    }
  };

  const stopVoice = () => {
    if (!recording) return;
    setRecording(false);
    recorder.current?.stop();
  };

  const title = ["您要掛什麼科？", "我聽到的是這樣", "要哪一天？", "這位醫生可以嗎？", "請輸入身分證字號", "都幫您準備好了"][index];
  const subtitle = index === 0 ? "按住下面的麥克風，說出想看的科別與日期。" : index === 1 ? `「${transcript || "我要掛下禮拜三的眼科"}」` : index === 2 ? `${intent.department} · ${data.hospital}` : index === 3 ? dateText : index === 4 ? `${slot?.doctor} · ${dateText}` : "最後一步請家人幫您確認，或自行前往長庚網站。";

  return <main>
    <header className="topbar"><div className="brand"><span className="brandMark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M12 20.6s-7.6-4.6-10.2-9.2C.4 8.8 1.6 5.4 4.6 4.3c2.2-.8 4.5 0 5.9 1.8L12 8l1.5-1.9c1.4-1.8 3.7-2.6 5.9-1.8 3 1.1 4.2 4.5 2.8 7.1C21.6 16 12 20.6 12 20.6z" fill="currentColor"/><path d="M9 12h1.4l.9-1.6 1.4 3 .9-1.4H15" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>安心掛號</span></div><span className="demoPill">完整 Demo</span></header>
    <section className="shell" aria-live="polite">
      <div className="progressText">{index === 5 ? "資料已整理" : `第 ${index + 1} 步，共 5 步`}</div>
      <div className="progress" aria-hidden="true">{[0,1,2,3,4].map((n) => <span key={n} className={n < Math.min(index + 1, 5) ? "done" : ""} />)}</div>
      <div className="card">
        {busy && <div className="loading"><span className="spinner" /><strong>正在幫您查詢</strong><small>不用再按，等一下就好</small></div>}
        <p className="kicker">{index === 5 ? "掛號資料已整理" : "長輩友善掛號助理"}</p><h1>{title}</h1><p className="subtitle">{subtitle}</p>

        {index === 0 && <div className="voiceBlock">
          <button className={`mic ${recording ? "active" : ""}`} onPointerDown={() => void startVoice()} onPointerUp={stopVoice} onPointerLeave={stopVoice} onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) void startVoice(); }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stopVoice(); }} aria-label="按住說話">
            <span className="micEmoji" aria-hidden="true">🎤</span><strong>{recording ? "放開送出" : "按住說話"}</strong>
          </button>
          <div className="heard">{voiceStatus || "「我要掛下禮拜三的眼科」"}</div>
        </div>}

        {index === 1 && <><div className="intentCard"><div><span>要做什麼</span><strong>掛號</strong></div><div><span>科別</span><strong>{intent.department}</strong></div><div><span>日期</span><strong>{requestedWeekday ? `下${requestedWeekday}` : "下週"}</strong></div></div>{intent.department !== "眼科" && <p className="note">目前 Demo 僅串接台北長庚「眼科」的即時公開班表，其他科別會顯示為示範資料，僅供參考。</p>}<div className="choices"><button className="choice recommended" onClick={() => advance()}><span><strong>對，就是這樣</strong><small>查詢長庚公開掛號資訊</small></span></button><button className="choice" onClick={() => setIndex(0)}><span><strong>不對，我再說一次</strong></span></button></div></>}

        {index === 2 && <><div className="sourceLine"><span className={data.sourceMode === "live" ? "liveDot" : "demoDot"} />{data.sourceMode === "live" ? `${data.hospital} · 眼科即時公開班表（僅供參考）` : "長庚公開資料層 · 抓取失敗，顯示示範資料"}<a href={data.sourceUrl} target="_blank" rel="noreferrer">查看來源</a></div><div className="choices">{data.slots.map((item, n) => <button key={item.value} className={n === selected ? "choice recommended" : "choice"} onClick={() => { setSelected(n); advance(); }}><span><strong>{item.weekday}　{item.period}</strong><small>{item.displayDate}</small></span>{item.status && <em>{item.status}</em>}</button>)}</div></>}

        {index === 3 && <><div className="note">只讀取公開時段；不登入、不填病患資料，也不送出掛號。</div><div className="choices"><button className="choice recommended" onClick={() => advance()}><span><strong>{slot?.doctor}</strong><small>{slot?.time} 開始</small></span>{slot?.status && <em>{slot.status}</em>}</button><button className="choice" onClick={() => setIndex(2)}><span><strong>換別的時間</strong></span></button></div></>}

        {index === 4 && <div className="idBlock"><div className="idDisplay">{masked || "請選字母並輸入數字"}</div><p>1 個英文字母 + 9 個數字</p><p className="privacy">這組號碼只留在您的裝置上，不會上傳。</p><label className="letterLabel">第一碼英文字母<select value={letter} onChange={(e) => setLetter(e.target.value)}><option value="">請選擇</option>{letters.map((item) => <option key={item}>{item}</option>)}</select></label><div className="keypad">{["1","2","3","4","5","6","7","8","9","0","刪除"].map((key) => <button key={key} onClick={() => setDigits((value) => key === "刪除" ? value.slice(0,-1) : `${value}${key}`.slice(0,9))}>{key}</button>)}</div><button className="primary" disabled={!validId} onClick={() => advance()}>好了，下一步</button></div>}

        {index === 5 && <><dl className="recap"><div><dt>醫院</dt><dd>{data.hospital}</dd></div><div><dt>科別</dt><dd>{intent.department}</dd></div><div><dt>醫生</dt><dd>{slot?.doctor}</dd></div><div><dt>時間</dt><dd>{dateText}</dd></div></dl><div className="finalActions"><button type="button" className={`notifyButton ${notifySent ? "sent" : ""}`} onClick={() => void notifyFamily()}>自動通知家人 LINE</button>{notifyStatus && <p className="notifyStatus">{notifyStatus}</p>}<a className="lineButton" href={`https://line.me/R/share?text=${shareText}`} target="_blank" rel="noreferrer">改用手動分享 LINE</a>{validId && <button type="button" className="copyIdButton" onClick={() => void copyId()}>複製身分證字號</button>}{copyStatus && <p className="copyStatus">{copyStatus}</p>}<a className="officialButton" href={slot?.checkinUrl || data.sourceUrl} target="_blank" rel="noreferrer">前往長庚確認掛號</a></div><p className="safety">已經幫您篩好有號的時段、備好資料，最後一步請本人或家屬點上方按鈕，到長庚官方網站按下確認掛號。</p></>}
      </div>
      <div className="footerActions">{index > 0 && <button onClick={() => setIndex((current) => Math.max(current - 1,0))}>← 上一步</button>}<a href="https://register.cgmh.org.tw/" target="_blank" rel="noreferrer">我不確定，開啟長庚網站</a></div>
      <p className="disclaimer">此為 Hackathon 示範。</p>
    </section>
  </main>;
}
