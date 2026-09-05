import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://anxin-registration-demo.modest-loon-8360.chatgpt.site"),
  title: "安心掛號｜長輩友善掛號助理",
  description: "用大字、語音與清楚步驟協助長輩準備醫院掛號資料的互動示範。",
  openGraph: { title: "安心掛號｜長輩友善掛號助理", description: "用大字、語音與清楚步驟協助長輩準備醫院掛號資料的互動示範。", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant-TW"><body>{children}</body></html>;
}
