import { Suspense } from "react";
import { HomeClient } from "@/components/home-client";
import { listContracts } from "@/lib/db";

export default function Home() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-6xl px-4 py-16 text-sm text-muted">Loading the watchlist…</main>}>
      <HomeLoader />
    </Suspense>
  );
}

async function HomeLoader() {
  const contracts = await listContracts().catch(() => []);
  return <HomeClient initial={contracts} />;
}
