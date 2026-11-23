# Fathom

Index and watch any EVM contract, even unverified ones.

Fathom is a security watch for contracts that block explorers leave as raw bytecode. Paste an address, pick a chain, and Fathom reads the code, follows the proxy, recovers an ABI, indexes recent logs, and fires rules to a webhook or Telegram. Trading agents can read the same decoded history over REST, GraphQL, or SQL.

The closest public tool, evmquery, can read an unverified contract. It does not keep the event history or watch it. Fathom does.

## What a judge can click through

![Home](docs/screenshots/home.png)

1. Open the app and pick **WETH** (verified) or **Unverified**.
2. The contract page shows the ABI with a confidence tag on every item, a chart, and decoded logs.
3. Save a transfer rule pointed at `/api/inbox`. Matching events already in the window are delivered immediately.
4. Open **Inbox** and the GraphQL playground.

![Verified WETH](docs/screenshots/weth.png)

![Recovered ABI](docs/screenshots/unverified.png)

![Decoded events](docs/screenshots/weth-events.png)

![Webhook delivery](docs/screenshots/inbox.png)

## Demo contracts

| Contract | Chain | Address | What it shows |
| --- | --- | --- | --- |
| WETH | Ethereum | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Sourcify ABI. Deposits, withdrawals, and transfers decoded as verified. |
| Unverified watcher | Ethereum | `0x43f3c2464359f30025fa0374a0f080a7e24aafa8` | No Sourcify match. Heimdall rebuilds functions (`owner`, `deposit`, `pause`, …). `Swap` and `Bribe` are recovered from log topics. Unknown topics stay guessed. |
| Aave V3 Pool | Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | EIP-1967 proxy. Implementation `0x4295Fe69b3e978Eb511e4558B4407AD871612fCb`. Logs are read from the proxy. |
| Native USDC | Arbitrum One | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Same flow on Arbitrum. |
| Native USDC | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Same flow on Base. |

These were watched against public RPCs on 23 Nov 2026. The unverified contract is active and unpublished on Sourcify; it can be upgraded or go quiet later.

## Architecture

```mermaid
flowchart LR
  user[Dashboard] --> api[Next.js API]
  api --> pg[(Postgres)]
  api --> rpc[Chain RPC]
  api --> src[Sourcify and Etherscan]
  api --> sig[OpenChain and builtin signatures]
  api --> heimdall[heimdall-rs]
  api --> files[Generated Ponder project]
  worker[Watch worker] --> rpc
  worker --> pg
  worker --> hook[Webhook and Telegram]
  agent[Trading agent] --> gql[GraphQL and SQL]
  gql --> pg
```

1. **Bytecode and proxy.** `eth_getCode`, then EIP-1167 (including the Solady clone), EIP-1967 implementation / admin / beacon, the legacy Zeppelin implementation slot, and slot 0 on short proxies. A beacon is asked for `implementation()`. Diamonds that expose `facetAddresses()` contribute their facet selectors. The watch still indexes logs from the address you pasted, because delegatecall events are emitted there.
2. **ABI.** Sourcify first, Etherscan when `ETHERSCAN_API_KEY` is set. If nothing verified is found, the worker runs `heimdall decompile` on the logic bytecode and keeps the ABI plus decompiled Solidity. Selectors are also pulled from the dispatcher and resolved through a small builtin set and the OpenChain signature database. Each item is tagged:
   - **verified** — Sourcify or Etherscan
   - **recovered** — heimdall resolved a name, or a signature database matched the selector or topic0
   - **guessed** — selector or topic with no trustworthy name; heimdall may still have guessed argument types
3. **Index.** A worker calls `eth_getLogs` over a short trailing window (default 80 blocks, at most 100 logs on the first pass) and decodes with viem. For recovered events whose ABI does not say which arguments are indexed, Fathom tries the combinations that fit the topic count. After the backfill, the worker tails new blocks.
4. **Ponder.** The same ABI is written to `generated/ponder/<chain>-<address>/` as a Ponder 0.18 project: `ponder.config.ts`, `ponder.schema.ts`, event handlers, and a Hono app exposing `graphql()` and `client()` SQL-over-HTTP. The live dashboard is filled by Fathom's worker, not by a second long-running Ponder process. See [Why the worker indexes](#why-the-worker-indexes).
5. **Alerts.** Rules: large transfer, mint (or transfer from the zero address), ownership or role change, proxy upgrade, or any event. Delivery is a JSON webhook and, when configured, a Telegram message. The first save checks logs already indexed and sends at most three matches so a busy token cannot flood the endpoint.
6. **Agents.** `GET /api/v1/:chainId/:address`, `/events`, and `/abi`, plus `POST /api/graphql` and `POST /api/sql`. A stdio MCP server in `mcp/server.mjs` calls that REST API.

## Run it

Docker Compose is the one command. It starts Postgres 16 and the app, and downloads the heimdall binary inside the image.

```bash
cp .env.example .env   # optional; public RPC defaults are already set
docker compose up --build
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`SEED_DEMO=true` (the Compose default) queues WETH, the unverified mainnet contract, the Aave V3 Pool proxy, and USDC on Base when those addresses are not already watched. Set `SEED_DEMO=false` to skip that.

A public URL for judges is a Render Blueprint. The steps, the account you need, and the free-tier limits are in [DEPLOY.md](DEPLOY.md).

Compose puts the app and Postgres on the host network so they meet on `127.0.0.1`. That stays up in nested Docker, where the default bridge often drops traffic between containers. On Docker Desktop, if host networking is unavailable, remove both `network_mode: host` lines, publish `5432:5432` on Postgres and `43123:43123` on the app, and set `DATABASE_URL` to `postgresql://fathom:fathom@postgres:5432/fathom`.

Without Compose, from this directory:

```bash
docker compose up -d postgres
cp .env.example .env
npm install
# linux amd64 heimdall binary, if you want decompilation outside Docker
mkdir -p bin
curl -fsSL -o bin/heimdall https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.3/heimdall-linux-amd64
chmod +x bin/heimdall
npm run dev
```

Tests do not need a database or a chain:

```bash
npm test
```

### Environment

See `.env.example`. Nothing secret is committed.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres. Compose overrides the host to `postgres`. |
| `ETH_RPC_URL`, `ARBITRUM_RPC_URL`, `BASE_RPC_URL` | Chain RPCs. Public defaults are set so the demo runs with no key. |
| `ETHERSCAN_API_KEY` | Optional. Sourcify is used either way. |
| `TELEGRAM_BOT_TOKEN` | Optional. Webhooks work without it. |
| `INDEX_BLOCK_RANGE`, `INDEX_MAX_LOGS`, `INDEX_CHUNK_SIZE` | How far back to read, and how hard to push the RPC. |
| `HEIMDALL_BIN` | Path to the heimdall-rs binary. |

## Demo script

With the stack up:

```bash
npm run demo
# or another contract:
node scripts/demo.mjs 0x43f3c2464359f30025fa0374a0f080a7e24aafa8 1 60
```

The script refreshes a watch, waits until it is ready, posts a large-transfer rule at the in-app inbox, and prints a GraphQL page. Then show:

- [http://127.0.0.1:43123](http://127.0.0.1:43123) — the watchlist
- the contract page, tabs **ABI**, **Events**, **Alerts**, **Indexer**
- [http://127.0.0.1:43123/inbox](http://127.0.0.1:43123/inbox)
- [http://127.0.0.1:43123/api/graphql](http://127.0.0.1:43123/api/graphql)

A GraphQL query:

```graphql
query {
  decodedEvents(limit: 5, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chainId: 1) {
    totalCount
    items { eventName confidence blockNumber txHash argsJson }
  }
}
```

SQL is read-only, single statement, three second timeout:

```bash
curl -s http://127.0.0.1:43123/api/sql \
  -H 'content-type: application/json' \
  -d '{"query":"select event_name, confidence, count(*) from decoded_events group by 1, 2 order by 3 desc limit 10"}'
```

Agent REST:

```bash
curl -s http://127.0.0.1:43123/api/v1/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/events?limit=5
```

Agents that speak MCP can run `node mcp/server.mjs` with `FATHOM_URL` pointed at the app. Tools: `get_contract`, `get_abi`, `list_events`.

To run the generated Ponder process yourself (separate schema, so it does not collide with Fathom's tables):

```bash
cd generated/ponder/1-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
npm install
DATABASE_URL=postgresql://fathom:fathom@127.0.0.1:5432/fathom \
DATABASE_SCHEMA=fathom_ponder \
npm run dev
```

Ponder then serves its own GraphQL at `http://127.0.0.1:42069/graphql` and SQL-over-HTTP at `http://127.0.0.1:42069/sql`. The block range in the generated config is the same short window Fathom used.

## Why the worker indexes

Ponder's config, schema, and handlers are static files evaluated at process start. A "paste any address" product would have to rewrite those files and restart Ponder for every watch, and Ponder would re-sync through `eth_getLogs` itself. On a public RPC that restart is slow and easy to rate-limit, which is a bad demo.

Fathom still generates a real Ponder 0.18 project (config, schema, per-event handlers, GraphQL and SQL middleware). The worker indexes that same ABI into Postgres immediately, and the app serves GraphQL and a guarded SQL endpoint over that table. That is the path `docker compose up` runs. Starting the generated project is a second, optional step.

## What works, and what is limited

Worked end to end against public RPCs on 23 Nov 2026:

- WETH on mainnet: Sourcify ABI, decoded `Transfer` / `Deposit` / `Withdrawal`, chart, webhook alerts into `/api/inbox` (HTTP 202, payload visible in the inbox).
- Unverified `0x43f3…AFa8`: heimdall returned 103 ABI entries in about 8 seconds (73 recovered, 35 guessed). `Swap` and `Bribe` decoded from topics. GraphQL and SQL returned them.
- Aave V3 Pool: EIP-1967 implementation resolved, Sourcify ABI, proxy logs indexed.
- Native USDC on Arbitrum One and Base: indexed. Both are proxies; Fathom labeled them `oz-legacy` because the legacy Zeppelin slot held an implementation address. Treat the kind as a hint and check the implementation on the contract page.

Limits, on purpose or from the tools:

- **Decompiler accuracy.** Heimdall names and types are guesses. This run produced suspicious types such as `uint72`, and many functions stay `Unresolved_<selector>` until OpenChain or the builtin set matches them. Decompiled Solidity is shown as untrusted and may not compile.
- **Signature collisions.** A topic0 or selector match is a known preimage, not a proof the author used that name. Standard events such as `Transfer` are safe. Obscure matches are tagged recovered, not verified.
- **Indexed arguments.** Verified ABIs use the published `indexed` flags. Recovered events try every layout that fits the log. The first one that decodes wins, preferring indexed arguments at the front.
- **Proxy edges.** EIP-1167, Solady clones, EIP-1967, beacons, the legacy Zeppelin slot, and slot 0 on short bytecode are covered. Custom slots, older Gnosis patterns that do not use slot 0, and diamonds without `facetAddresses()` are not. Follow depth is three.
- **RPC cost.** Defaults stay small because public `eth_getLogs` fails or truncates on wide ranges, especially WETH. Raise `INDEX_BLOCK_RANGE` only with your own RPC. The live tail keeps reading new blocks for watched contracts.
- **Alerts.** Backfill sends at most three matches per rule. Telegram is skipped cleanly when `TELEGRAM_BOT_TOKEN` is unset. Webhooks must be `http` or `https`.
- **Chains.** Ethereum mainnet, Arbitrum One, and Base. No Solana or Stellar yet.
- **Ponder process.** Generated and runnable, not started by Compose. See above.

## Tests

`npm test` covers ABI merge (verified beats recovered and guessed, heimdall unresolved selectors, event topic0), Ponder config and handler generation, EIP-1167 / Solady / EIP-1967 / beacon resolution, decoded logs with inferred `indexed` positions, alert matching, and the SQL guard.

## Roadmap

- **Solana and Stellar.** The watch is "address in, decoded history out." The next adapters would be Solana program accounts (IDL or disassembly) and Stellar contract specs, with the same confidence tags and alert rules.
- **Hosted tier.** One-click watches, managed RPC, and a retained history longer than the local window. The Compose stack stays the free local path.
- **Paid alerts.** Webhook and Telegram stay free at low volume. A paid lane would add guaranteed delivery, more rules (balance drift, new unverified implementation), and a per-seat history.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the heimdall-rs and Ponder copyrights.
