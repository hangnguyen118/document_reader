import { LibraryView } from "@/components/library-view";
import { Analytics } from "@vercel/analytics/next";
export default function Page() {
  return (
    <>
      <LibraryView />
      <Analytics />
    </>
  );
}
