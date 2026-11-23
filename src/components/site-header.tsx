import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-serif text-[1.7rem] leading-none tracking-tight">Fathom</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted sm:inline">
            Contract watch
          </span>
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          <Link href="/inbox" className="hover:text-foreground">
            Inbox
          </Link>
          <Link href="/api/graphql" className="hover:text-foreground">
            GraphQL
          </Link>
        </nav>
      </div>
    </header>
  );
}
