"use client";

import { useEffect, useState } from "react";

type Delivery = { id: string; receivedAt: string; body: unknown };

export function InboxClient({ initial = [] }: { initial?: Delivery[] }) {
  const [rows, setRows] = useState<Delivery[]>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const response = await fetch("/api/inbox");
      const body = (await response.json()) as { deliveries?: Delivery[]; error?: string };
      if (stop) return;
      if (!response.ok) setError(body.error ?? "Inbox unavailable");
      else setRows(body.deliveries ?? []);
      timer = setTimeout(tick, 2000);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-4xl tracking-tight">Alert inbox</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Webhooks aimed at this app land here. Point a rule at <span className="font-mono">/api/inbox</span> and the payload
        shows up without an external receiver.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="mt-8 text-sm text-muted">No deliveries yet.</p> : null}
      <ul className="mt-6 space-y-4">
        {rows.map((row) => (
          <li key={row.id} className="panel p-4">
            <p className="font-mono text-xs text-muted">{row.receivedAt.replace("T", " ").slice(0, 19)} UTC</p>
            <pre className="mt-2 overflow-auto font-mono text-xs leading-relaxed text-foreground">{JSON.stringify(row.body, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
