"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookOpen, Bookmark, Check, ChevronRight, CloudOff, GraduationCap, Heart, Library, Menu, Moon, NotebookPen, Settings2, Sun, X } from "lucide-react";
import { useTheme } from "@hangnguyen1902/theme";
import { useReading } from "./providers";

const nav = [{ href: "/", name: "My library", icon: Library }, { href: "/favorites", name: "Favorites", icon: Heart }, { href: "/vocabulary", name: "Vocabulary", icon: Bookmark }, { href: "/learn", name: "Practice", icon: GraduationCap }, { href: "/notes", name: "My notes", icon: NotebookPen }];
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { vocabulary, documents, pending, error, notice } = useReading();
  const { resolvedTheme, mounted, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const reading = path.startsWith("/read/");
  const title = reading ? "Reading room" : path === "/settings" ? "Settings" : nav.find((item) => item.href === path)?.name ?? "My library";
  return <div className={`app-shell ${reading ? "reading-shell" : ""}`}>
    {open && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "open" : ""}`}><Link href="/" className="brand" onClick={() => setOpen(false)}><span className="brand-icon"><BookOpen size={22} strokeWidth={1.6} /></span><span>folio<span>.</span></span></Link><div className="sidebar-caption">A little space for your mind.</div><div className="nav-label">YOUR SPACE</div><nav aria-label="Main navigation">{nav.map(({ href, name, icon: Icon }) => <Link key={href} href={href} className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={18} strokeWidth={1.7} /><span>{name}</span>{href === "/vocabulary" && <span aria-hidden="true" className="nav-count">{vocabulary.length}</span>}{href === "/favorites" && documents.some((item) => item.favorite) && <span aria-hidden="true" className="nav-count">{documents.filter((item) => item.favorite).length}</span>}</Link>)}</nav><div className="sidebar-reading-note"><span className="small-book"><BookOpen size={21} strokeWidth={1.5} /></span><p>One page at a time.</p><span>Read a little. Learn a little.<br />Make it a daily thing.</span></div><div className="sidebar-bottom"><Link href="/settings" className={path === "/settings" ? "active" : ""} onClick={() => setOpen(false)}><Settings2 size={17} /><span>Settings</span></Link><div className="local-status"><CloudOff size={13} /><span>Saved on this device</span><span className="status-dot" /></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button type="button" className="icon-button menu-button" aria-label={open ? "Close navigation menu" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={19} /> : <Menu size={19} />}</button><span>Your space</span><ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-right"><span className="save-status">{error ? <CloudOff size={12} /> : <Check size={12} />}{error ? "Storage unavailable" : pending ? "Saving…" : "All changes saved"}</span><span className="topbar-line" /><button type="button" className="icon-button theme-toggle" aria-label={mounted && resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>{mounted && resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><span className="profile-initial" aria-label="Local reader">F</span></div></header>{error && <div className="storage-error" role="alert">{error}</div>}<main className={reading ? "reader-main" : "main-content"}>{children}</main></div>{notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
  </div>;
}
