import type { Metadata } from "next";
import { ThemeScript } from "@hangnguyen1902/theme/server";
import "@hangnguyen1902/theme/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

export const metadata: Metadata = { title: { default: "Folio — A little space for your mind", template: "%s · Folio" }, description: "Read, listen, collect words, and make room for a little learning. Your personal reading library, saved on your device." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><ThemeScript defaultTheme="light" storageKey="folio-theme" /></head><body><Providers><Shell>{children}</Shell></Providers></body></html>;
}
