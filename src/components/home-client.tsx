"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAINS, type ChainId } from "@/lib/chains";
import { EXAMPLES } from "@/lib/examples";
import { shortAddress } from "@/lib/format";

type Watch = {
  id: string;
  chainId: number;
  address: string;
  displayName: string | null;
  status: string;
  statusDetail: string | null;
  logsIndexed: number;
  isProxy: boolean;
  proxyKind: string | null;
};

export function HomeClient({ initial = [] }: { initial?: Watch[] }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<ChainId>(1);
  const [blockRange, setBlockRange] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [watches, setWatches] = useState<Watch[]>(initial);

  async function load() {
    const response = await fetch("/api/contracts");
    const body = (await response.json()) as { contracts?: Watch[]; error?: string };
    if (response.ok && body.contracts) setWatches(body.contracts);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = false;
    async function tick() {
      await load();
      if (!stop) timer = setTimeout(tick, 3000);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function watch(next = { address, chainId, blockRange, refresh: false }) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = (await response.json()) as { contract?: { id: string }; error?: string };
      if (!response.ok || !body.contract) throw new Error(body.error ?? "Could not start the watch");
      router.push(`/contracts/${body.contract.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the watch");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Security watch for raw bytecode</p>
      <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight sm:text-6xl">
        Index and watch any EVM contract, even unverified ones.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
        Paste an address. Fathom reads the bytecode, follows proxies, and uses a verified ABI when Sourcify or
        Etherscan has one. Otherwise heimdall-rs and signature recovery rebuild the interface. Recent logs are indexed,
        then your rules fire to a webhook or Telegram.
      </p>

      <form
        className="panel mt-8 grid gap-3 p-3 sm:grid-cols-[1fr_180px_120px_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void watch();
        }}
      >
        <label className="grid gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Contract</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            className="h-11 border border-line bg-background px-3 font-mono text-sm"
            required
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Chain</span>
          <select
            value={chainId}
            onChange={(event) => setChainId(Number(event.target.value) as ChainId)}
            className="h-11 border border-line bg-background px-3 text-sm"
          >
            {Object.values(CHAINS).map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Blocks</span>
          <input
            type="number"
            min={20}
            max={2000}
            value={blockRange}
            onChange={(event) => setBlockRange(Number(event.target.value))}
            className="h-11 border border-line bg-background px-3 font-mono text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-11 bg-signal px-5 text-sm font-medium text-signal-ink disabled:opacity-60"
        >
          {pending ? "Starting…" : "Watch"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">Default window stays short so a public RPC is not asked for a full history.</p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => {
              setAddress(example.address);
              setChainId(example.chainId);
              void watch({ address: example.address, chainId: example.chainId, blockRange, refresh: false });
            }}
            className="panel p-4 text-left hover:border-signal"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium">{example.label}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal">{example.detail}</span>
            </span>
            <span className="mt-2 block font-mono text-xs text-muted">{shortAddress(example.address)}</span>
            <span className="mt-2 block text-sm leading-relaxed text-muted">{example.blurb}</span>
          </button>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="font-serif text-2xl">Watchlist</h2>
        {watches.length === 0 ? (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Nothing indexed yet. A verified contract shows its Sourcify ABI. An unverified one comes back with recovered
            selectors, heimdall functions, and decoded logs.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {watches.map((watch) => (
              <li key={watch.id}>
                <a href={`/contracts/${watch.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-medium">{watch.displayName || shortAddress(watch.address)}</span>
                    <span className="font-mono text-xs text-muted">
                      {CHAINS[watch.chainId as ChainId]?.name ?? watch.chainId} · {watch.address}
                    </span>
                  </span>
                  <span className="text-right font-mono text-xs text-muted">
                    <span className="block uppercase tracking-[0.14em] text-foreground">{watch.status}</span>
                    {watch.logsIndexed} logs{watch.isProxy ? ` · ${watch.proxyKind}` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
