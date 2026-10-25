import { ReaderView } from "@/components/reader-view";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense fallback={<Loading />}><ReaderView documentId={id} /></Suspense>; }
