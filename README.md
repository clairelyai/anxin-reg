   ## 📊 專案設計背景：高齡化與數位醫療落差


  本程式的設計初衷與重要性，是建立在對高齡者醫療需求與數位落差的深刻洞察之上。我們發現長者雖然是醫療服務的重度使用者
  ，但現有數位工具的門檻往往將他們拒之門外。

    為了讓大家更了解我們為什麼要這樣設計介面與功能，我們整理了一份視覺化儀表板：
    👉 **[點此觀看：高齡化社會與醫療數位落差 視覺化儀表板](https://htmlpreview.github.io/?https://github.
  com/clairelyai/anxin-reg/blob/main/elderly_medical_dashboard.html)**

    此儀表板傳達了本專案的核心目標：透過高齡友善的介面設計，解決長者就醫痛點，並賦能長者自主使用數位醫療服務。
  # 安心掛號 Anxin Registration Demo

長輩友善的醫院掛號流程 Hackathon Demo。介面以大字、少量選項、語音輸入與家屬交棒為核心；目前不登入醫院、不接觸病患資料，也不會自動送出真實掛號。

線上版本：<https://anxin-registration-demo.modest-loon-8360.chatgpt.site>

## 已完成

- 按住說話的錄音介面
- Whisper speech-to-text API 端點，未設定金鑰時自動使用瀏覽器語音辨識
- LLM 結構化意圖解析，輸出 `intent / department / date`
- 沒有 API key 時的確定性解析備援
- 台灣身分證基本格式 `^[A-Z][0-9]{9}$`，首碼可選 A–Z
- 長庚公開掛號頁面的唯讀連線檢查
- 醫師、日期、餘額的穩定示範資料，畫面會明確標示為 Demo
- LINE 官方分享 URL，可分享不含身分證的掛號摘要
- 最後一步保留給本人或家屬，不自動送出掛號

## 本機啟動

需求：Node.js 22.13 以上。

```bash
npm install
cp .env.example .env.local
npm run dev
```

開啟 <http://localhost:3000>。

正式建置：

```bash
npm run build
```

## 語音與 LLM

伺服器端環境變數：

```dotenv
OPENAI_API_KEY=
TRANSCRIPTION_MODEL=whisper-1
INTENT_MODEL=gpt-4o-mini
```

- `POST /api/voice`：接收 multipart audio，轉送 OpenAI audio transcription API。
- `POST /api/intent`：把文字解析為掛號意圖；沒有 key 時使用本機規則。
- 金鑰只放在部署平台 secret 或本機 `.env.local`，不要提交 Git。
- 錄音不寫入檔案、不進資料庫，API 回應完成後即丟棄。

## 長庚資料層

`GET /api/cgmh` 只讀取長庚公開掛號入口，確認網站與眼科入口可用。現階段顯示的醫師、日期與餘額是穩定示範資料，不宣稱為即時號源。

下一階段建議：

1. 明確選定院區，目前產品文案以「林口長庚」為目標。
2. 用獨立 Playwright worker 執行公開頁面 recon，只取得院區、科別、醫師與可掛日期。
3. 對 selector 變更、逾時與驗證碼採 fail-safe：回到示範資料或電話交棒。
4. 不自動填寫身分證、不操作取消掛號、不按下最後確認。

## LINE 分享

完成頁使用：

```text
https://line.me/R/share?text=...
```

分享內容不含身分證。此 URL scheme 主要在已安裝 LINE 的 iOS／Android 上運作；若線上站點維持私人存取，家人仍需要相同網站權限才能打開摘要連結。

## 主要檔案

- `app/page.tsx`：完整互動流程與瀏覽器語音備援
- `app/api/voice/route.ts`：Whisper / speech-to-text
- `app/api/intent/route.ts`：LLM 意圖解析與本機備援
- `app/api/cgmh/route.ts`：長庚公開資料層
- `app/globals.css`：既有介面樣式
- `.openai/hosting.json`：Sites 部署與儲存綁定；首次部署時會寫入自己的 `project_id`

## 安全邊界

- 不提交或紀錄身分證、API key、錄音及個人醫療資料。
- 不繞過 CAPTCHA。
- 不碰長庚 HIS 或任何內部資料庫。
- 不把示範時段標示成即時號源。
- 不替使用者執行最終掛號或取消。
