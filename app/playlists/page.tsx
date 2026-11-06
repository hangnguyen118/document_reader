import type { Metadata } from "next";
import { PlaylistsView } from "@/components/playlists-view";

export const metadata: Metadata = { title: "My Playlist" };
export default function Page() { return <PlaylistsView />; }
