import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/client/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: "오프라인 행사용 실시간 골든벨 퀴즈 사이트",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
