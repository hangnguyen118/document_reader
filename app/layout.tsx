import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeScript } from "@hangnguyen1902/theme/server";
import "@hangnguyen1902/theme/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

// Keep the complete Vietnamese glyphs and mark positioning on every device.
// Load on use so the library does not download either reading font unnecessarily.
const readingSerif = localFont({ src: "../public/fonts/NotoSerif-Regular.ttf", weight: "400", style: "normal", display: "swap", preload: false, adjustFontFallback: false, variable: "--folio-reading-serif" });
const readingSans = localFont({ src: "../public/fonts/NotoSans-Regular.ttf", weight: "400", style: "normal", display: "swap", preload: false, adjustFontFallback: false, variable: "--folio-reading-sans" });

export const metadata: Metadata = { title: { default: "Folio — A little space for your mind", template: "%s · Folio" }, description: "Read, listen, collect words, and make room for a little learning. Your personal reading library, saved on your device." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><ThemeScript defaultTheme="light" storageKey="folio-theme" /></head><body className={`${readingSerif.variable} ${readingSans.variable}`}><Providers><Shell>{children}</Shell></Providers></body></html>;
}
