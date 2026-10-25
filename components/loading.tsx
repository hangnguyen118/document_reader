import { Skeleton } from "@hangnguyen1902/theme";
export function Loading({ label = "Opening your space…" }: { label?: string }) {
  return <div className="loading-state" role="status"><Skeleton width="45%" height="2rem" /><Skeleton width="70%" height="1rem" /><div className="loading-cards"><Skeleton height="12rem" /><Skeleton height="12rem" /><Skeleton height="12rem" /></div><span>{label}</span></div>;
}
