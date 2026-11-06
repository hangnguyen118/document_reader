import type { Metadata } from "next";
import { PlaylistDetailView } from "@/components/playlists-view";

export const metadata: Metadata = { title: "Playlist" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistDetailView id={id} />;
}
