import { Suspense } from "react";
import { ContractView } from "@/components/contract-view";
import { contractDetail } from "@/lib/db";

export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted">Loading watch…</main>}>
      <ContractLoader params={params} />
    </Suspense>
  );
}

async function ContractLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await contractDetail(id);
  if (!initial) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-danger">Watch not found.</p>
      </main>
    );
  }
  return <ContractView id={id} initial={initial as never} />;
}
