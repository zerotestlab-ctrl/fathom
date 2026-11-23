import { Suspense } from "react";
import { InboxClient } from "@/components/inbox-client";
import { listInbox } from "@/lib/db";

export default function InboxPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted">Loading inbox…</main>}>
      <InboxLoader />
    </Suspense>
  );
}

async function InboxLoader() {
  const deliveries = await listInbox().catch(() => []);
  return <InboxClient initial={deliveries} />;
}
