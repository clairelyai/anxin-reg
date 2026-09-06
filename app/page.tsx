"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Intent = { intent: "register"; department: string; date: string; visitType?: string };
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
  const department = /眼|目睭|看不清楚|視力|流眼油|畏光/.test(text) ? "眼科"
    : /皮膚|癢|疹子|濕疹|長痘/.test(text) ? "皮膚科"
    : /耳|鼻|喉|喉嚨痛|鼻塞|耳鳴/.test(text) ? "耳鼻喉科"
    : "眼科";
  const date = /三/.test(text) ? "next Wednesday" : /五/.test(text) ? "next Friday" : "next week";
  const visitType = /回診|複診|再來|上次/.test(text) ? "複診" : /初診|第一次|新病人/.test(text) ? "初診" : "未確定";
  return { intent: "register", department, date, visitType };
}

// A static reminder to travel with the appointment once it's confirmed — the
// "看診後提醒" step: what to bring and when to arrive, so the family member
// receiving the LINE message has the full picture, not just the time/doctor.
const VISIT_PREP_NOTE = "看診提醒：請於看診時間前 30 分鐘完成報到，記得攜帶健保卡與身分證正本；如需請假或改期，請依長庚官方規定辦理。";

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
  const [misheardCount, setMisheardCount] = useState(0);
  const [helpStatus, setHelpStatus] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [medNote, setMedNote] = useState("");
  const [followupWeeks, setFollowupWeeks] = useState<number | null>(null);
  // "安心助理" home screen + two lightweight, scripted side-flows that sit
  // alongside the voice registration flow: 看不懂這個 (photo/document
  // understanding) and 請家人幫忙 (direct escalation). All three are gated by
  // `mode` so the existing 0-5 step registration flow below is completely
  // untouched when mode !== "register".
  const [mode, setMode] = useState<"home" | "register" | "photo" | "family">("home");
  const [photoStep, setPhotoStep] = useState<"upload" | "analyzing" | "result">("upload");
  const [photoAdded, setPhotoAdded] = useState(false);
  const [photoUnsure, setPhotoUnsure] = useState(false);
  const [familyContext, setFamilyContext] = useState<"general" | "photo">("general");
  const [familyStatus, setFamilyStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const browserTranscript = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/cgmh").then((r) => r.ok ? r.json() : Promise.reject()).then(setData).catch(() => {});
    try {
      if (localStorage.getItem("anxin-large-text") === "1") setLargeText(true);
    } catch { /* private browsing or storage blocked — default size is fine */ }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // "放大文字" preference — a body-level class so every screen (not just the
  // current step) reflects it, and it's remembered next time this device
  // opens the site.
  useEffect(() => {
    document.body.classList.toggle("textLarge", largeText);
    try { localStorage.setItem("anxin-large-text", largeText ? "1" : "0"); } catch { /* ignore */ }
  }, [largeText]);

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

  // Scripted "document understanding" result for the 看不懂這個 flow — no real
  // image AI call, just a realistic fixed example (a clinic follow-up notice)
  // computed with a real near-future date so it doesn't look stale in a demo.
  const photoDoc = useMemo(() => {
    const d = nextWeekday(5);
    return { date: `${d.getMonth() + 1} 月 ${d.getDate()} 日（五）`, time: "上午 10:30", place: "台北 XX 醫院" };
  }, []);

  // Chronic-disease follow-up reminder — lightweight version: no background
  // job actually fires later, we just compute the suggested follow-up date
  // now (appointment date + N weeks) and fold it into the message that goes
  // out today, so the family member has it in writing right away.
  const followupDateText = useMemo(() => {
    if (!followupWeeks || !slot?.date) return null;
    const base = new Date(slot.date);
    if (Number.isNaN(base.getTime())) return null;
    base.setDate(base.getDate() + followupWeeks * 7);
    return `${base.getMonth() + 1} 月 ${base.getDate()} 日前後`;
  }, [followupWeeks, slot]);

  const shareText = useMemo(() => encodeURIComponent([
    "家人的掛號資料已準備好",
    data.hospital,
    `${intent.department}｜${slot?.doctor || "待選醫師"}`,
    dateText,
    `查看掛號資訊：${SITE_URL}`,
    ...(slot?.checkinUrl ? [`前往長庚確認掛號：${slot.checkinUrl}`] : []),
    VISIT_PREP_NOTE,
    ...(medNote.trim() ? [`用藥提醒：${medNote.trim()}`] : []),
    ...(followupDateText ? [`回診提醒：建議約 ${followupDateText}（${followupWeeks} 週後）回診，請提前上網掛號`] : []),
    "（示範流程，尚未送出真實掛號）",
  ].join("\n")), [data.hospital, dateText, intent.department, slot, medNote, followupDateText, followupWeeks]);

  // Reads a short line of text aloud — used so a long-sighted or
  // low-vision elderly user can confirm what was understood, or hear the
  // final recap, without having to read small text on screen. Silently
  // does nothing on a browser without speech synthesis support.
  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-TW";
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch { /* speech synthesis unavailable — the on-screen text still shows */ }
  };

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

  // Escalation path for when the long-press-to-talk step keeps mishearing
  // the elderly user (misheardCount tracked via the "不對，我再說一次"
  // button below): instead of looping forever, offer to send whatever we
  // *did* hear straight to the family member's LINE so a person can help
  // decide, rather than the elderly user getting stuck alone.
  const askFamilyForHelp = async () => {
    setHelpStatus("正在通知家人協助…");
    const message = [
      "長輩正在使用安心掛號，目前卡在說明需求這一步。",
      `系統目前聽到的是：「${transcript || "（尚未聽清楚）"}」`,
      "麻煩幫忙確認想掛的科別與時間，或直接打電話問一下。",
      `查看畫面：${SITE_URL}`,
    ].join("\n");
    try {
      const response = await fetch("/api/line/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: message }) });
      if (!response.ok) throw new Error("notify_failed");
      setHelpStatus("已通知家人協助 ✓");
    } catch {
      setHelpStatus("尚未設定自動通知，請直接打電話請家人協助");
    }
  };

  // Sends a message to the family LINE recipient(s) from the two home-level
  // flows (direct "請家人幫忙" and the "我還是不懂" escalation inside 看不懂這個).
  // Kept separate from askFamilyForHelp below (which is specific to the
  // registration flow's mishear escalation) so neither message's wording has
  // to compromise for the other's context.
  const sendFamilyHelp = async () => {
    setFamilyStatus("sending");
    const message = familyContext === "photo"
      ? [
          "長輩用「安心助理」拍了一張看不懂的通知，想請您確認。",
          `AI 判斷內容：回診 ${photoDoc.date} ${photoDoc.time}，${photoDoc.place}`,
          "如果內容看起來不對、或需要付款，請直接確認或回電，不要讓長輩自己處理。",
          `查看畫面：${SITE_URL}`,
        ].join("\n")
      : [
          "長輩正在使用安心助理，AI 不確定能不能安全處理，需要您協助確認一下。",
          transcript ? `目前記錄到的內容：「${transcript}」` : "尚未取得詳細內容，麻煩直接聯絡確認。",
          `查看畫面：${SITE_URL}`,
        ].join("\n");
    try {
      const response = await fetch("/api/line/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: message }) });
      if (!response.ok) throw new Error("notify_failed");
      setFamilyStatus("sent");
    } catch {
      setFamilyStatus("failed");
    }
  };

  // Resets every side-flow's local state and returns to the home screen —
  // used by every "← 回首頁" link so re-entering a flow always starts clean.
  const goHome = () => {
    setMode("home");
    setPhotoStep("upload");
    setPhotoAdded(false);
    setPhotoUnsure(false);
    setFamilyStatus("idle");
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
    setMode("register");
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
    <header className="topbar"><div className="brand"><span className="brandMark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M12 20.6s-7.6-4.6-10.2-9.2C.4 8.8 1.6 5.4 4.6 4.3c2.2-.8 4.5 0 5.9 1.8L12 8l1.5-1.9c1.4-1.8 3.7-2.6 5.9-1.8 3 1.1 4.2 4.5 2.8 7.1C21.6 16 12 20.6 12 20.6z" fill="currentColor"/><path d="M9 12h1.4l.9-1.6 1.4 3 .9-1.4H15" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>安心掛號<small className="brandTagline">高齡者健康照護數位助手</small></span></div><div className="topbarActions"><button type="button" className="textSizeButton" aria-pressed={largeText} onClick={() => setLargeText((value) => !value)}>{largeText ? "Aa 恢復預設字體" : "Aa 放大文字"}</button></div></header>
    <section className="shell" aria-live="polite">
      {mode === "home" && <div className="card">
        <p className="kicker">安心助理</p>
        <h1>今天需要什麼幫忙？</h1>
        <p className="subtitle">說出你的需求，AI 幫你處理；真的不確定時，家人會在。</p>
        <div className="voiceBlock">
          <button className={`mic ${recording ? "active" : ""}`} onPointerDown={() => void startVoice()} onPointerUp={stopVoice} onPointerLeave={stopVoice} onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) void startVoice(); }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stopVoice(); }} aria-label="按住說話">
            <span className="micEmoji" aria-hidden="true">🎤</span><strong>{recording ? "放開送出" : "按住說話"}</strong>
          </button>
          <div className="heard">{voiceStatus || "「我要改下禮拜三的眼科掛號」"}</div>
        </div>
        <div className="homeEntries">
          <button type="button" className="homeEntry" onClick={() => { setIndex(0); setMode("register"); }}><span className="homeEntryIcon" aria-hidden="true">🏥</span><span><strong>醫院掛號</strong><small>掛號、查詢、更改時間</small></span></button>
          <button type="button" className="homeEntry" onClick={() => { setPhotoStep("upload"); setPhotoAdded(false); setPhotoUnsure(false); setMode("photo"); }}><span className="homeEntryIcon" aria-hidden="true">📷</span><span><strong>看不懂這個</strong><small>拍照讓我幫你看看</small></span></button>
          <button type="button" className="homeEntry" onClick={() => { setFamilyContext("general"); setFamilyStatus("idle"); setMode("family"); }}><span className="homeEntryIcon" aria-hidden="true">👨‍👩‍👧</span><span><strong>請家人幫忙</strong><small>我不確定時，通知家人</small></span></button>
        </div>
      </div>}

      {mode === "photo" && <div className="card">
        <p className="kicker">看不懂這個</p>
        <h1>{photoStep === "result" ? "這張通知在說" : "文件理解"}</h1>
        <p className="subtitle">{photoStep === "result" ? "AI 幫您整理重點如下，僅供參考。" : "把相機對準你看不懂的東西，或從照片選擇。"}</p>
        {photoStep !== "result" && <div className="voiceBlock">
          <div className="photoIcon" aria-hidden="true">📷</div>
          <div className="choices">
            <button type="button" className="choice recommended" disabled={photoStep === "analyzing"} onClick={() => { setPhotoStep("analyzing"); setTimeout(() => setPhotoStep("result"), 900); }}><span><strong>開啟相機</strong></span></button>
            <button type="button" className="choice" disabled={photoStep === "analyzing"} onClick={() => { setPhotoStep("analyzing"); setTimeout(() => setPhotoStep("result"), 900); }}><span><strong>從照片選擇</strong></span></button>
          </div>
          {photoStep === "analyzing" && <div className="heard">正在幫您看這張圖片…</div>}
        </div>}
        {photoStep === "result" && <>
          <div className="intentCard">
            <div><span>📅 回診</span><strong>{photoDoc.date}</strong></div>
            <div><span>🕙 時間</span><strong>{photoDoc.time}</strong></div>
            <div><span>🏥 地點</span><strong>{photoDoc.place}</strong></div>
          </div>
          <div className="choices">
            <button type="button" className="choice recommended" onClick={() => setPhotoAdded(true)}><span><strong>加入提醒</strong></span></button>
            <button type="button" className="choice" onClick={() => setPhotoUnsure(true)}><span><strong>我還是不懂</strong></span></button>
          </div>
          {photoAdded && <p className="notifyStatus">已加入提醒 ✓</p>}
          {photoUnsure && <div className="helpBlock cautionBlock"><p className="note">⚠️ 我不確定這則訊息是否安全，建議請家人再確認一次。</p><button type="button" className="helpButton" onClick={() => { setFamilyContext("photo"); setFamilyStatus("idle"); setMode("family"); }}>請家人看看</button></div>}
        </>}
        <div className="footerActions"><button type="button" onClick={goHome}>← 回首頁</button></div>
      </div>}

      {mode === "family" && <div className="card">
        <p className="kicker">請家人幫忙</p>
        <h1>{familyStatus === "sent" ? "已通知家人" : "這件事需要確認"}</h1>
        <p className="subtitle">
          {familyStatus === "sent" ? "我已經把問題整理好了，不用重新解釋。"
            : familyStatus === "failed" ? "尚未設定自動通知，請直接打電話請家人協助。"
            : familyContext === "photo" ? "這張通知的內容不確定是否安全，我先不幫您處理，可以請家人一起看看。"
            : "真的不確定的時候，我不會自己硬猜，可以請家人一起看看。"}
        </p>
        {(familyStatus === "idle" || familyStatus === "sending") && <button type="button" className="helpButton" disabled={familyStatus === "sending"} onClick={() => void sendFamilyHelp()}>👨‍👩‍👧 請家人幫忙</button>}
        {familyStatus === "sent" && <div className="familyPreview">
          <p className="reminderHint">家人端會看到的訊息：</p>
          <div className="intentCard">
            <div><span>狀態</span><strong>{familyContext === "photo" ? "看不懂的通知" : "需要協助"}</strong></div>
            <div><span>內容摘要</span><strong>{familyContext === "photo" ? `回診 ${photoDoc.date} ${photoDoc.time}` : (transcript || "尚未聽清楚的需求")}</strong></div>
          </div>
        </div>}
        <div className="footerActions"><button type="button" onClick={goHome}>← 回首頁</button></div>
      </div>}

      {mode === "register" && <><div className="progressText">{index === 5 ? "資料已整理" : `${index + 1} / 5`}</div>
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

        {index === 1 && <><button type="button" className="ttsButton" onClick={() => speak(`您說的是掛${intent.department}${intent.visitType && intent.visitType !== "未確定" ? "，" + intent.visitType : ""}，時間是${requestedWeekday ? "下" + requestedWeekday : "下週"}。對的話請按對，就是這樣。`)}>🔊 唸給我聽</button><div className="intentCard"><div><span>要做什麼</span><strong>掛號</strong></div><div><span>科別</span><strong>{intent.department}</strong></div>{intent.visitType && intent.visitType !== "未確定" && <div><span>類型</span><strong>{intent.visitType}</strong></div>}<div><span>日期</span><strong>{requestedWeekday ? `下${requestedWeekday}` : "下週"}</strong></div></div><p className="note">科別是根據您說的內容判斷的建議，不是醫療診斷；{intent.department !== "眼科" ? "目前 Demo 僅串接台北長庚「眼科」的即時公開班表，其他科別會顯示為示範資料，僅供參考。" : "如果不確定，可以請家人再次確認。"}</p><div className="choices"><button className="choice recommended" onClick={() => { setMisheardCount(0); advance(); }}><span><strong>對，就是這樣</strong><small>查詢長庚公開掛號資訊</small></span></button><button className="choice" onClick={() => { setMisheardCount((n) => n + 1); setIndex(0); }}><span><strong>不對，我再說一次</strong></span></button></div>{misheardCount >= 2 && <div className="helpBlock"><button type="button" className="helpButton" onClick={() => void askFamilyForHelp()}>改請家人協助</button>{helpStatus && <p className="notifyStatus">{helpStatus}</p>}</div>}</>}

        {index === 2 && <><div className="sourceLine"><span className={data.sourceMode === "live" ? "liveDot" : "demoDot"} />{data.sourceMode === "live" ? `${data.hospital} · 眼科即時公開班表（僅供參考）` : "長庚公開資料層 · 抓取失敗，顯示示範資料"}<a href={data.sourceUrl} target="_blank" rel="noreferrer">查看來源</a></div><div className="choices">{data.slots.map((item, n) => <button key={item.value} className={n === selected ? "choice recommended" : "choice"} onClick={() => { setSelected(n); advance(); }}><span><strong>{item.weekday}　{item.period}</strong><small>{item.displayDate}</small></span>{item.status && <em>{item.status}</em>}</button>)}</div></>}

        {index === 3 && <><div className="note">只讀取公開時段；不登入、不填病患資料，也不送出掛號。</div><div className="choices"><button className="choice recommended" onClick={() => advance()}><span><strong>{slot?.doctor}</strong><small>{slot?.time} 開始</small></span>{slot?.status && <em>{slot.status}</em>}</button><button className="choice" onClick={() => setIndex(2)}><span><strong>換別的時間</strong></span></button></div></>}

        {index === 4 && <div className="idBlock"><div className="idDisplay">{masked || "請選字母並輸入數字"}</div><p>1 個英文字母 + 9 個數字</p><p className="privacy">這組號碼只留在您的裝置上，不會上傳。</p><label className="letterLabel">第一碼英文字母<select value={letter} onChange={(e) => setLetter(e.target.value)}><option value="">請選擇</option>{letters.map((item) => <option key={item}>{item}</option>)}</select></label><div className="keypad">{["1","2","3","4","5","6","7","8","9","0","刪除"].map((key) => <button key={key} onClick={() => setDigits((value) => key === "刪除" ? value.slice(0,-1) : `${value}${key}`.slice(0,9))}>{key}</button>)}</div><button className="primary" disabled={!validId} onClick={() => advance()}>好了，下一步</button></div>}

        {index === 5 && <><button type="button" className="ttsButton" onClick={() => speak(`已經幫您安排好了。${data.hospital}，${intent.department}，${slot?.doctor}，時間是${dateText}。${VISIT_PREP_NOTE}`)}>🔊 唸給我聽</button><dl className="recap"><div><dt>醫院</dt><dd>{data.hospital}</dd></div><div><dt>科別</dt><dd>{intent.department}</dd></div>{intent.visitType && intent.visitType !== "未確定" && <div><dt>類型</dt><dd>{intent.visitType}</dd></div>}<div><dt>醫生</dt><dd>{slot?.doctor}</dd></div><div><dt>時間</dt><dd>{dateText}</dd></div></dl><p className="note">{VISIT_PREP_NOTE}</p><div className="reminderBlock"><label className="reminderLabel">用藥提醒（選填）<input type="text" value={medNote} onChange={(e) => setMedNote(e.target.value)} placeholder="例如：早晚各一次，白色血壓藥" /></label><div className="reminderLabel">回診提醒（選填）<div className="weekChoices">{[4, 8, 12].map((weeks) => <button key={weeks} type="button" className={followupWeeks === weeks ? "weekChoice active" : "weekChoice"} onClick={() => setFollowupWeeks((current) => current === weeks ? null : weeks)}>{weeks} 週後</button>)}</div></div>{followupDateText && <p className="notifyStatus">將提醒約 {followupDateText}（{followupWeeks} 週後）應回診</p>}<p className="reminderHint">以上提醒會一起放進下面傳給家人的 LINE 訊息裡；目前不會在時間到了另外自動跳出通知，仍需要家人幫忙留意日期。</p></div><div className="finalActions"><button type="button" className={`notifyButton ${notifySent ? "sent" : ""}`} onClick={() => void notifyFamily()}>自動通知家人 LINE</button>{notifyStatus && <p className="notifyStatus">{notifyStatus}</p>}<a className="lineButton" href={`https://line.me/R/share?text=${shareText}`} target="_blank" rel="noreferrer">改用手動分享 LINE</a>{validId && <button type="button" className="copyIdButton" onClick={() => void copyId()}>複製身分證字號</button>}{copyStatus && <p className="copyStatus">{copyStatus}</p>}<a className="officialButton" href={slot?.checkinUrl || data.sourceUrl} target="_blank" rel="noreferrer">前往長庚確認掛號</a></div><p className="safety">已經幫您篩好有號的時段、備好資料，最後一步請本人或家屬點上方按鈕，到長庚官方網站按下確認掛號。</p></>}
      </div>
      <div className="footerActions">{index > 0 ? <button onClick={() => setIndex((current) => Math.max(current - 1,0))}>← 上一步</button> : <button onClick={goHome}>← 回首頁</button>}<a href="https://register.cgmh.org.tw/" target="_blank" rel="noreferrer">我不確定，開啟長庚網站</a></div>
      </>}
      <p className="disclaimer">此為 Hackathon 示範。</p>
    </section>
  </main>;
}
