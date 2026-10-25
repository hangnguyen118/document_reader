import Link from "next/link";
export default function NotFound() { return <div className="empty-state"><h1>This page is between chapters.</h1><p>Let&apos;s take you back to your library.</p><Link href="/" className="text-link">Back to library →</Link></div>; }
