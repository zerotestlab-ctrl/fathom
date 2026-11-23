"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CHAINS, explorerAddress, explorerTx, type ChainId } from "@/lib/chains";
import { formatTime, formatUnits, parseHumanAmount, shortAddress } from "@/lib/format";

const EventChart = dynamic(() => import("@/components/event-chart").then((mod) => mod.EventChart), { ssr: false });

type Detail = {
  contract: {
    id: string;
    chainId: number;
    address: string;
    displayName: string | null;
    status: string;
    statusDetail: string | null;
    isProxy: boolean;
    proxyKind: string | null;
    implementation: string | null;
    adminAddress: string | null;
    abiSource: string | null;
    fromBlock: string | null;
    toBlock: string | null;
    headBlock: string | null;
    logsIndexed: number;
    blockRange: number;
    error: string | null;
    decompiled: string | null;
    ponderFiles: Record<string, string>;
    meta: {
      bytecodeBytes?: number;
      logicBytecodeBytes?: number;
      tokenName?: string | null;
      symbol?: string | null;
      decimals?: number | null;
      warnings?: string[];
      heimdall?: { status: string; message?: string; durationMs?: number };
      facets?: string[];
      proxyChain?: string[];
      abiCounts?: { verified: number; recovered: number; guessed: number };
    };
  };
  abiItems: {
    id: string;
    kind: string;
    name: string;
    signature: string;
    selector: string | null;
    confidence: "verified" | "recovered" | "guessed";
    source: string;
    stateMutability: string | null;
  }[];
  events: {
    id: string;
    eventName: string;
    signature: string | null;
    confidence: string;
    args: Record<string, unknown>;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }[];
  rules: {
    id: string;
    kind: string;
    threshold: string | null;
    webhookUrl: string | null;
    telegramChatId: string | null;
  }[];
  fires: {
    id: string;
    webhookStatus: string | null;
    telegramStatus: string | null;
    backfill: boolean;
    createdAt: string;
    payload: unknown;
  }[];
  chart: { label: string; count: number }[];
};

const TABS = ["Overview", "ABI", "Events", "Alerts", "Indexer"] as const;
const CONFIDENCE = {
  verified: "bg-verified/15 text-verified",
  recovered: "bg-recovered/15 text-recovered",
  guessed: "bg-white/5 text-guessed",
};

function Badge({ value }: { value: string }) {
  const tone = CONFIDENCE[value as keyof typeof CONFIDENCE] ?? "bg-white/5 text-muted";
  return <span className={`px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone}`}>{value}</span>;
}

function formatArg(key: string, value: unknown, decimals: number | null): string {
  if (typeof value === "string" && /^\d+$/.test(value) && decimals !== null && /value|amount|wad|tokens/.test(key)) {
    return `${formatUnits(value, decimals)} (${value})`;
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return shortAddress(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ContractView({ id, initial = null }: { id: string; initial?: Detail | null }) {
  const [detail, setDetail] = useState<Detail | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [abiFilter, setAbiFilter] = useState("");
  const [kind, setKind] = useState("large_transfer");
  const [amount, setAmount] = useState("1");
  const [webhook, setWebhook] = useState("");
  const [telegram, setTelegram] = useState("");
  const [fileName, setFileName] = useState("ponder.config.ts");
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setWebhook(`${window.location.origin}/api/inbox`);
    const requested = new URLSearchParams(window.location.search).get("tab");
    const match = TABS.find((item) => item.toLowerCase() === requested);
    if (match) setTab(match);
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const response = await fetch(`/api/contracts/${id}`);
      const body = (await response.json()) as Detail & { error?: string };
      if (stop) return;
      if (!response.ok) {
        setError(body.error ?? "Watch not found");
        return;
      }
      setDetail(body);
      const status = body.contract.status;
      if (status !== "ready" && status !== "error") timer = setTimeout(tick, 1500);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const contract = detail?.contract;
  const decimals = contract?.meta.decimals ?? null;
  const filteredAbi = useMemo(() => {
    const needle = abiFilter.toLowerCase();
    return (detail?.abiItems ?? []).filter((item) =>
      `${item.kind} ${item.name} ${item.signature} ${item.selector ?? ""}`.toLowerCase().includes(needle),
    );
  }, [abiFilter, detail?.abiItems]);

  useEffect(() => {
    if (!contract) return;
    setQuery(`query {
  decodedEvents(limit: 5, address: "${contract.address}", chainId: ${contract.chainId}, orderDirection: "desc") {
    totalCount
    items { eventName confidence blockNumber txHash argsJson }
  }
}`);
  }, [contract]);

  async function createAlert(event: FormEvent) {
    event.preventDefault();
    if (!contract) return;
    setNotice(null);
    const threshold =
      kind === "large_transfer"
        ? decimals !== null
          ? parseHumanAmount(amount, decimals)
          : /^\d+$/.test(amount)
            ? amount
            : null
        : null;
    if (kind === "large_transfer" && !threshold) {
      setNotice("Threshold must be a number.");
      return;
    }
    const response = await fetch(`/api/contracts/${id}/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, threshold, webhookUrl: webhook, telegramChatId: telegram }),
    });
    const body = (await response.json()) as { error?: string; fires?: Detail["fires"] };
    if (!response.ok) {
      setNotice(body.error ?? "Could not save the rule");
      return;
    }
    setNotice(body.fires?.length ? `Rule saved. ${body.fires.length} alert${body.fires.length === 1 ? "" : "s"} delivered.` : "Rule saved. No matching events in the current window.");
    const refreshed = await fetch(`/api/contracts/${id}`);
    if (refreshed.ok) setDetail(await refreshed.json());
  }

  async function testRule(ruleId: string) {
    const response = await fetch(`/api/contracts/${id}/alerts/${ruleId}/test`, { method: "POST" });
    const body = (await response.json()) as { error?: string };
    setNotice(response.ok ? "Test payload sent." : body.error ?? "Test failed");
    const refreshed = await fetch(`/api/contracts/${id}`);
    if (refreshed.ok) setDetail(await refreshed.json());
  }

  async function runQuery(path: string, payload: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setQueryResult(JSON.stringify(await response.json(), null, 2));
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-signal">
          Back to the watchlist
        </Link>
      </main>
    );
  }
  if (!contract || !detail) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Loading watch</p>
      </main>
    );
  }

  const chain = CHAINS[contract.chainId as ChainId];
  const busy = contract.status === "queued" || contract.status === "analyzing" || contract.status === "indexing";
  const files = Object.keys(contract.ponderFiles);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted hover:text-foreground">
        Watchlist
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">{chain?.name ?? contract.chainId}</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">{contract.displayName || shortAddress(contract.address)}</h1>
          <a className="mt-2 block font-mono text-sm text-muted hover:text-foreground" href={explorerAddress(contract.chainId, contract.address)}>
            {contract.address}
          </a>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs uppercase tracking-[0.16em]">{busy ? contract.statusDetail || contract.status : contract.status}</p>
          <p className="mt-1 text-sm text-muted">{contract.logsIndexed} events indexed</p>
        </div>
      </div>

      {contract.error ? (
        <p role="alert" className="mt-4 border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-danger">
          {contract.error}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        {[
          ["ABI", contract.abiSource ?? "pending"],
          ["Proxy", contract.isProxy ? contract.proxyKind : "none"],
          ["Window", contract.fromBlock ? `${contract.fromBlock} → ${contract.toBlock}` : "pending"],
          ["Bytecode", contract.meta.bytecodeBytes ? `${contract.meta.bytecodeBytes} bytes` : "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface px-3 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</dt>
            <dd className="mt-1 truncate text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-line">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`px-3 py-2 text-sm ${tab === item ? "border-b-2 border-signal text-foreground" : "text-muted"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Overview" ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="panel p-4">
            <h2 className="font-serif text-2xl">Events over the window</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Counts are grouped by block, or by hour when the window spans more than two hours.
            </p>
            <EventChart data={detail.chart} />
          </div>
          <div className="grid gap-4">
            <div className="panel p-4">
              <h2 className="font-serif text-2xl">Resolution</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {contract.isProxy
                  ? `Proxy ${contract.proxyKind}. Logic lives at ${contract.implementation}.`
                  : "No proxy pattern matched. The ABI comes from this address's bytecode."}
              </p>
              {contract.meta.proxyChain?.length ? (
                <p className="mt-2 font-mono text-xs text-muted">{contract.meta.proxyChain.join(" → ")}</p>
              ) : null}
              <p className="mt-3 font-mono text-xs text-muted">
                {contract.meta.abiCounts?.verified ?? 0} verified · {contract.meta.abiCounts?.recovered ?? 0} recovered ·{" "}
                {contract.meta.abiCounts?.guessed ?? 0} guessed
              </p>
              {contract.meta.heimdall ? (
                <p className="mt-2 text-sm text-muted">
                  Heimdall {contract.meta.heimdall.status}
                  {contract.meta.heimdall.durationMs ? ` in ${Math.round(contract.meta.heimdall.durationMs / 1000)}s` : ""}.{" "}
                  {contract.meta.heimdall.message}
                </p>
              ) : null}
            </div>
            {contract.meta.warnings?.length ? (
              <ul className="panel space-y-2 p-4 text-sm text-muted">
                {contract.meta.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {contract.decompiled ? (
            <details className="panel p-4 lg:col-span-2">
              <summary className="cursor-pointer font-medium">Decompiled Solidity from heimdall</summary>
              <pre className="mt-3 max-h-80 overflow-auto font-mono text-xs leading-relaxed text-muted">{contract.decompiled}</pre>
            </details>
          ) : null}
        </section>
      ) : null}

      {tab === "ABI" ? (
        <section className="mt-6">
          <input
            value={abiFilter}
            onChange={(event) => setAbiFilter(event.target.value)}
            placeholder="Filter by name, signature, or selector"
            className="h-10 w-full border border-line bg-background px-3 text-sm sm:max-w-md"
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Signature</th>
                  <th className="py-2 pr-3">Confidence</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {filteredAbi.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-muted">
                      {busy ? "ABI recovery is still running." : "No ABI items matched."}
                    </td>
                  </tr>
                ) : (
                  filteredAbi.map((item) => (
                    <tr key={item.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3 font-mono text-xs text-muted">{item.kind}</td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{item.signature || item.name}</span>
                        {item.selector ? <span className="mt-1 block font-mono text-[11px] text-muted">{item.selector}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge value={item.confidence} />
                      </td>
                      <td className="py-2 font-mono text-xs text-muted">{item.source}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "Events" ? (
        <section className="mt-6 overflow-x-auto">
          {detail.events.length === 0 ? (
            <p className="text-sm text-muted">
              {busy ? "Indexing logs from the recent block window." : "No logs in this window. Re-watch with a wider block range."}
            </p>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Args</th>
                  <th className="py-2 pr-3">Block</th>
                  <th className="py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {detail.events.map((event) => (
                  <tr key={event.id} className="border-t border-line align-top">
                    <td className="py-3 pr-3">
                      <span className="block font-medium">{event.eventName}</span>
                      <Badge value={event.confidence} />
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs leading-5 text-muted">
                      {Object.keys(event.args).length === 0
                        ? "raw log"
                        : Object.entries(event.args).map(([key, value]) => (
                            <span key={key} className="block">
                              {key}: {formatArg(key, value, decimals)}
                            </span>
                          ))}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs">
                      {event.blockNumber}
                      <span className="mt-1 block text-muted">{formatTime(event.blockTimestamp ? Number(event.blockTimestamp) : null)}</span>
                    </td>
                    <td className="py-3">
                      <a className="font-mono text-xs text-signal" href={explorerTx(contract.chainId, event.txHash)}>
                        {shortAddress(event.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === "Alerts" ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <form className="panel grid gap-3 p-4" onSubmit={createAlert}>
            <h2 className="font-serif text-2xl">New rule</h2>
            <label className="grid gap-1 text-sm">
              When
              <select value={kind} onChange={(event) => setKind(event.target.value)} className="h-10 border border-line bg-background px-2">
                <option value="large_transfer">Transfer at or above a threshold</option>
                <option value="mint">Mint, or transfer from the zero address</option>
                <option value="ownership_change">Ownership or admin role change</option>
                <option value="proxy_upgrade">Proxy upgrade</option>
                <option value="any_event">Any indexed event</option>
              </select>
            </label>
            {kind === "large_transfer" ? (
              <label className="grid gap-1 text-sm">
                Threshold {decimals !== null ? `(${contract.meta.symbol || "tokens"})` : "(raw units)"}
                <input value={amount} onChange={(event) => setAmount(event.target.value)} className="h-10 border border-line bg-background px-2 font-mono" />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              Webhook
              <input value={webhook} onChange={(event) => setWebhook(event.target.value)} className="h-10 border border-line bg-background px-2 font-mono text-xs" />
            </label>
            <label className="grid gap-1 text-sm">
              Telegram chat id
              <input value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="optional" className="h-10 border border-line bg-background px-2 font-mono" />
            </label>
            <button type="submit" className="h-10 bg-signal text-sm font-medium text-signal-ink">
              Save and check indexed events
            </button>
            {notice ? <p className="text-sm text-muted">{notice}</p> : null}
            <p className="text-xs leading-relaxed text-muted">
              Saving a rule checks the events already indexed and delivers at most three matches, so a busy token cannot flood the webhook. New blocks are checked after that.
            </p>
          </form>
          <div>
            <h2 className="font-serif text-2xl">Deliveries</h2>
            {detail.rules.length === 0 ? <p className="mt-2 text-sm text-muted">No rules yet.</p> : null}
            <ul className="mt-3 space-y-3">
              {detail.rules.map((rule) => (
                <li key={rule.id} className="panel p-3 text-sm">
                  <span className="font-medium">{rule.kind}</span>
                  {rule.threshold ? <span className="ml-2 font-mono text-xs text-muted">≥ {rule.threshold}</span> : null}
                  <button type="button" onClick={() => testRule(rule.id)} className="ml-3 text-xs text-signal">
                    Send test
                  </button>
                  <span className="mt-1 block truncate font-mono text-xs text-muted">{rule.webhookUrl}</span>
                </li>
              ))}
            </ul>
            <ul className="mt-4 space-y-2">
              {detail.fires.map((fire) => (
                <li key={fire.id} className="border-t border-line py-2 text-xs">
                  <span className="font-mono text-muted">{fire.createdAt.replace("T", " ").slice(0, 19)} UTC</span>
                  <span className="ml-2">webhook {fire.webhookStatus}</span>
                  <span className="ml-2 text-muted">telegram {fire.telegramStatus}</span>
                  {fire.backfill ? <span className="ml-2 text-recovered">backfill</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {tab === "Indexer" ? (
        <section className="mt-6 grid gap-4">
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            Fathom wrote a Ponder 0.18 project for this contract and indexed the same events into Postgres. The queries
            below hit Fathom&apos;s API, which uses the same table the generated handlers fill. Run the project itself with
            the command in its README when you want Ponder&apos;s own process on port 42069.
          </p>
          <div className="flex flex-wrap gap-2">
            {files.map((name) => (
              <button key={name} type="button" onClick={() => setFileName(name)} className={`border px-2 py-1 font-mono text-xs ${fileName === name ? "border-signal text-signal" : "border-line text-muted"}`}>
                {name}
              </button>
            ))}
          </div>
          <pre className="panel max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed text-muted">{contract.ponderFiles[fileName]}</pre>
          <div className="grid gap-3 lg:grid-cols-2">
            <form
              className="panel grid gap-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void runQuery("/api/graphql", { query });
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">GraphQL</span>
              <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={8} className="border border-line bg-background p-2 font-mono text-xs" />
              <button className="h-9 bg-signal text-sm text-signal-ink">Run query</button>
            </form>
            <form
              className="panel grid gap-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void runQuery("/api/sql", { query: String(form.get("sql") ?? "") });
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">SQL</span>
              <textarea
                name="sql"
                rows={8}
                defaultValue={`select event_name, confidence, count(*) as n\nfrom decoded_events\nwhere contract_id = '${contract.id}'\ngroup by 1, 2\norder by n desc`}
                className="border border-line bg-background p-2 font-mono text-xs"
              />
              <button className="h-9 bg-signal text-sm text-signal-ink">Run SQL</button>
            </form>
          </div>
          {queryResult ? <pre className="panel max-h-80 overflow-auto p-4 font-mono text-xs text-muted">{queryResult}</pre> : null}
        </section>
      ) : null}
    </main>
  );
}
