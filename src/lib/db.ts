import postgres from "postgres";
import { chartBuckets } from "@/lib/chart";
import { env } from "@/lib/env";
import { asRecord } from "@/lib/format";
import type { TaggedAbiItem } from "@/lib/abi/types";

type Sql = ReturnType<typeof postgres>;

const globalDb = globalThis as unknown as { __fathomSql?: Sql; __fathomReady?: Promise<void> };

function getDb(): Sql {
  if (!globalDb.__fathomSql) {
    globalDb.__fathomSql = postgres(env().databaseUrl, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return globalDb.__fathomSql;
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL,
    status_detail TEXT,
    is_proxy BOOLEAN NOT NULL DEFAULT FALSE,
    proxy_kind TEXT,
    implementation TEXT,
    admin_address TEXT,
    abi_source TEXT,
    abi JSONB NOT NULL DEFAULT '[]'::jsonb,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    from_block BIGINT,
    to_block BIGINT,
    head_block BIGINT,
    logs_indexed INTEGER NOT NULL DEFAULT 0,
    block_range INTEGER NOT NULL DEFAULT 80,
    error TEXT,
    decompiled TEXT,
    ponder_files JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, address)
  )`,
  `CREATE TABLE IF NOT EXISTS abi_items (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    signature TEXT NOT NULL,
    selector TEXT,
    inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
    outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
    state_mutability TEXT,
    anonymous BOOLEAN,
    confidence TEXT NOT NULL,
    source TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS decoded_events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    chain_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    event_name TEXT NOT NULL,
    signature TEXT,
    confidence TEXT NOT NULL,
    args JSONB NOT NULL DEFAULT '{}'::jsonb,
    topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    data TEXT,
    block_number BIGINT NOT NULL,
    block_timestamp BIGINT,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS decoded_events_contract_block ON decoded_events (contract_id, block_number DESC)`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    threshold TEXT,
    event_name TEXT,
    webhook_url TEXT,
    telegram_chat_id TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS alert_fires (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    contract_id TEXT NOT NULL,
    event_id TEXT,
    payload JSONB NOT NULL,
    webhook_status TEXT,
    telegram_status TEXT,
    backfill BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS alert_fires_rule_event ON alert_fires (rule_id, event_id) WHERE event_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS webhook_inbox (
    id TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    body JSONB,
    headers JSONB
  )`,
];

export async function initDb(): Promise<void> {
  if (!globalDb.__fathomReady) {
    globalDb.__fathomReady = (async () => {
      for (const statement of STATEMENTS) await getDb().unsafe(statement);
    })().catch((error) => {
      globalDb.__fathomReady = undefined;
      throw error;
    });
  }
  return globalDb.__fathomReady;
}

type ContractRow = {
  id: string;
  chain_id: number;
  address: string;
  display_name: string | null;
  status: string;
  status_detail: string | null;
  is_proxy: boolean;
  proxy_kind: string | null;
  implementation: string | null;
  admin_address: string | null;
  abi_source: string | null;
  abi: unknown;
  meta: unknown;
  from_block: string | number | null;
  to_block: string | number | null;
  head_block: string | number | null;
  logs_indexed: number;
  block_range: number;
  error: string | null;
  decompiled: string | null;
  ponder_files: unknown;
  created_at: Date;
};

function num(value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function mapContract(row: ContractRow) {
  return {
    id: row.id,
    chainId: row.chain_id,
    address: row.address,
    displayName: row.display_name,
    status: row.status,
    statusDetail: row.status_detail,
    isProxy: row.is_proxy,
    proxyKind: row.proxy_kind,
    implementation: row.implementation,
    adminAddress: row.admin_address,
    abiSource: row.abi_source,
    fromBlock: num(row.from_block),
    toBlock: num(row.to_block),
    headBlock: num(row.head_block),
    logsIndexed: row.logs_indexed,
    blockRange: row.block_range,
    error: row.error,
    decompiled: row.decompiled,
    ponderFiles: asRecord(row.ponder_files),
    createdAt: row.created_at.toISOString(),
    meta: asRecord(row.meta),
  };
}

export type ContractView = ReturnType<typeof mapContract>;

export async function listContracts() {
  await initDb();
  const rows = await getDb()<ContractRow[]>`select * from contracts order by created_at desc limit 50`;
  return rows.map(mapContract);
}

export async function getContract(id: string) {
  await initDb();
  const rows = await getDb()<ContractRow[]>`select * from contracts where id = ${id}`;
  return rows[0] ? mapContract(rows[0]) : null;
}

export async function enqueueWatch(input: {
  chainId: number;
  address: string;
  blockRange: number;
  refresh?: boolean;
}) {
  await initDb();
  const existing = await getDb()<ContractRow[]>`
    select * from contracts where chain_id = ${input.chainId} and lower(address) = ${input.address.toLowerCase()}
  `;
  const current = existing[0];
  if (current && !input.refresh && current.status !== "error") return mapContract(current);
  if (current) {
    await getDb().begin(async (tx) => {
      await tx`delete from alert_fires where contract_id = ${current.id}`;
      await tx`delete from decoded_events where contract_id = ${current.id}`;
      await tx`delete from abi_items where contract_id = ${current.id}`;
      await tx`
        update contracts set
          status = 'queued',
          status_detail = 'Queued',
          error = null,
          logs_indexed = 0,
          decompiled = null,
          block_range = ${input.blockRange},
          updated_at = now()
        where id = ${current.id}
      `;
    });
    return (await getContract(current.id))!;
  }
  const id = crypto.randomUUID();
  await getDb()`
    insert into contracts (id, chain_id, address, status, status_detail, block_range)
    values (${id}, ${input.chainId}, ${input.address}, 'queued', 'Queued', ${input.blockRange})
  `;
  return (await getContract(id))!;
}

export async function claimQueued() {
  await initDb();
  const rows = await getDb().begin(async (tx) => {
    const picked = await tx<{ id: string }[]>`
      select id from contracts where status = 'queued' order by created_at asc limit 1 for update skip locked
    `;
    if (!picked[0]) return [];
    return tx<ContractRow[]>`
      update contracts
      set status = 'analyzing', status_detail = 'Starting', updated_at = now()
      where id = ${picked[0].id}
      returning *
    `;
  });
  return rows[0] ? mapContract(rows[0]) : null;
}

export async function resumeInterrupted() {
  await initDb();
  await getDb()`
    update contracts
    set status = 'queued', status_detail = 'Resumed after restart', updated_at = now()
    where status in ('analyzing', 'indexing')
  `;
}

export async function setProgress(id: string, status: string, detail: string) {
  await getDb()`
    update contracts set status = ${status}, status_detail = ${detail}, updated_at = now() where id = ${id}
  `;
}

export async function setError(id: string, message: string) {
  await getDb()`
    update contracts set status = 'error', error = ${message.slice(0, 500)}, status_detail = 'Failed', updated_at = now()
    where id = ${id}
  `;
}

export async function saveAnalysis(input: {
  id: string;
  displayName: string | null;
  isProxy: boolean;
  proxyKind: string | null;
  implementation: string | null;
  adminAddress: string | null;
  abiSource: string;
  abi: unknown;
  meta: unknown;
  fromBlock: bigint;
  toBlock: bigint;
  headBlock: bigint;
  decompiled: string | null;
  ponderFiles: Record<string, string>;
  items: TaggedAbiItem[];
}) {
  await getDb().begin(async (tx) => {
    await tx`
      update contracts set
        status = 'indexing',
        status_detail = 'Indexing logs',
        display_name = ${input.displayName},
        is_proxy = ${input.isProxy},
        proxy_kind = ${input.proxyKind},
        implementation = ${input.implementation},
        admin_address = ${input.adminAddress},
        abi_source = ${input.abiSource},
        abi = ${tx.json(input.abi as never)},
        meta = ${tx.json(input.meta as never)},
        from_block = ${input.fromBlock.toString()},
        to_block = ${input.toBlock.toString()},
        head_block = ${input.headBlock.toString()},
        decompiled = ${input.decompiled},
        ponder_files = ${tx.json(input.ponderFiles as never)},
        error = null,
        updated_at = now()
      where id = ${input.id}
    `;
    await replaceItems(tx as unknown as Sql, input.id, input.items);
  });
}

async function replaceItems(tx: Sql, contractId: string, items: TaggedAbiItem[]) {
  await tx`delete from abi_items where contract_id = ${contractId}`;
  for (const item of items) {
    await tx`
      insert into abi_items (
        id, contract_id, kind, name, signature, selector, inputs, outputs, state_mutability, anonymous, confidence, source
      ) values (
        ${crypto.randomUUID()},
        ${contractId},
        ${item.type},
        ${item.name},
        ${item.signature},
        ${item.selector || null},
        ${tx.json(item.inputs as never)},
        ${tx.json(item.outputs as never)},
        ${item.stateMutability ?? null},
        ${item.anonymous ?? null},
        ${item.confidence},
        ${item.source}
      )
    `;
  }
}

export async function replaceAbi(contractId: string, items: TaggedAbiItem[], abi: unknown, meta: unknown) {
  await getDb().begin(async (tx) => {
    await tx`update contracts set abi = ${tx.json(abi as never)}, meta = ${tx.json(meta as never)}, updated_at = now() where id = ${contractId}`;
    await replaceItems(tx as unknown as Sql, contractId, items);
  });
}

export type StoredEvent = {
  id: string;
  contractId: string;
  chainId: number;
  address: string;
  eventName: string;
  signature: string | null;
  confidence: string;
  args: Record<string, unknown>;
  blockNumber: string;
  blockTimestamp: string | null;
  txHash: string;
  logIndex: number;
};

function mapEvent(row: {
  id: string;
  contract_id: string;
  chain_id: number;
  address: string;
  event_name: string;
  signature: string | null;
  confidence: string;
  args: unknown;
  block_number: string | number;
  block_timestamp: string | number | null;
  tx_hash: string;
  log_index: number;
}): StoredEvent {
  return {
    id: row.id,
    contractId: row.contract_id,
    chainId: row.chain_id,
    address: row.address,
    eventName: row.event_name,
    signature: row.signature,
    confidence: row.confidence,
    args: asRecord(row.args),
    blockNumber: String(row.block_number),
    blockTimestamp: row.block_timestamp === null ? null : String(row.block_timestamp),
    txHash: row.tx_hash,
    logIndex: row.log_index,
  };
}

export async function insertEvents(
  rows: {
    id: string;
    contractId: string;
    chainId: number;
    address: string;
    eventName: string;
    signature: string;
    confidence: string;
    args: Record<string, unknown>;
    topics: string[];
    data: string;
    blockNumber: bigint;
    blockTimestamp: bigint | null;
    txHash: string;
    logIndex: number;
  }[],
) {
  if (!rows.length) return;
  await getDb().begin(async (tx) => {
    for (const row of rows) {
      await tx`
        insert into decoded_events (
          id, contract_id, chain_id, address, event_name, signature, confidence, args, topics, data,
          block_number, block_timestamp, tx_hash, log_index
        ) values (
          ${row.id}, ${row.contractId}, ${row.chainId}, ${row.address}, ${row.eventName}, ${row.signature || null},
          ${row.confidence}, ${tx.json(row.args as never)}, ${tx.json(row.topics as never)}, ${row.data},
          ${row.blockNumber.toString()}, ${row.blockTimestamp?.toString() ?? null}, ${row.txHash}, ${row.logIndex}
        )
        on conflict (id) do nothing
      `;
    }
  });
}

export async function getEvent(id: string): Promise<StoredEvent | null> {
  const rows = await getDb()`select * from decoded_events where id = ${id}`;
  return rows[0] ? mapEvent(rows[0] as never) : null;
}

export async function countEvents(contractId: string) {
  const rows = await getDb()`select count(*)::int as count from decoded_events where contract_id = ${contractId}`;
  return Number(rows[0]?.count ?? 0);
}

export async function listEvents(contractId: string, limit = 200): Promise<StoredEvent[]> {
  const rows = await getDb()`
    select * from decoded_events where contract_id = ${contractId}
    order by block_number desc, log_index desc
    limit ${limit}
  `;
  return rows.map((row) => mapEvent(row as never));
}

export async function markIndexed(id: string, logsIndexed: number, headBlock: bigint) {
  await getDb()`
    update contracts
    set status = 'ready', status_detail = 'Watching', logs_indexed = ${logsIndexed}, head_block = ${headBlock.toString()},
        to_block = ${headBlock.toString()}, error = null, updated_at = now()
    where id = ${id}
  `;
}

export async function listReady() {
  const rows = await getDb()<ContractRow[]>`select * from contracts where status = 'ready' order by updated_at desc limit 12`;
  return rows.map(mapContract);
}

export async function listAbiItems(contractId: string) {
  const rows = await getDb()`
    select id, kind, name, signature, selector, inputs, confidence, source, state_mutability, anonymous
    from abi_items where contract_id = ${contractId}
    order by case kind when 'event' then 0 when 'function' then 1 else 2 end, name
  `;
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    name: String(row.name),
    signature: String(row.signature),
    selector: row.selector ? String(row.selector) : null,
    inputs: row.inputs,
    confidence: String(row.confidence),
    source: String(row.source),
    stateMutability: row.state_mutability ? String(row.state_mutability) : null,
    anonymous: row.anonymous === true,
  }));
}

export async function contractDetail(id: string) {
  const contract = await getContract(id);
  if (!contract) return null;
  const [abiItems, events, rules, fires] = await Promise.all([
    listAbiItems(id),
    listEvents(id, 200),
    listRules(id),
    listFires(id),
  ]);
  return {
    contract,
    abiItems,
    events,
    rules,
    fires,
    chart: chartBuckets(
      events.map((event) => ({
        blockNumber: Number(event.blockNumber),
        timestamp: event.blockTimestamp ? Number(event.blockTimestamp) : null,
      })),
    ),
  };
}

export async function queryEvents(filter: {
  address?: string;
  chainId?: number;
  eventName?: string;
  limit: number;
  offset: number;
  direction: "asc" | "desc";
}) {
  await initDb();
  const limit = Math.min(200, Math.max(1, filter.limit));
  const offset = Math.max(0, filter.offset);
  const address = filter.address?.toLowerCase() ?? null;
  const direction = getDb().unsafe(filter.direction === "asc" ? "asc" : "desc");
  const rows = await getDb()`
    select * from decoded_events
    where (${address ? getDb()`lower(address) = ${address}` : getDb()`true`})
      and (${filter.chainId ? getDb()`chain_id = ${filter.chainId}` : getDb()`true`})
      and (${filter.eventName ? getDb()`event_name = ${filter.eventName}` : getDb()`true`})
    order by block_number ${direction}, log_index desc
    limit ${limit} offset ${offset}
  `;
  const countRows = await getDb()`
    select count(*)::int as count from decoded_events
    where (${address ? getDb()`lower(address) = ${address}` : getDb()`true`})
      and (${filter.chainId ? getDb()`chain_id = ${filter.chainId}` : getDb()`true`})
      and (${filter.eventName ? getDb()`event_name = ${filter.eventName}` : getDb()`true`})
  `;
  return { items: rows.map((row) => mapEvent(row as never)), totalCount: Number(countRows[0]?.count ?? 0) };
}

export async function runReadOnlyQuery(query: string) {
  await initDb();
  const rows = await getDb().begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    await tx.unsafe("SET LOCAL statement_timeout = '3000ms'");
    const result = await tx.unsafe(query);
    return result.slice(0, 200);
  });
  return rows;
}

export type RuleRow = {
  id: string;
  contractId: string;
  kind: string;
  threshold: string | null;
  eventName: string | null;
  webhookUrl: string | null;
  telegramChatId: string | null;
  enabled: boolean;
  createdAt: string;
};

function mapRule(row: {
  id: string;
  contract_id: string;
  kind: string;
  threshold: string | null;
  event_name: string | null;
  webhook_url: string | null;
  telegram_chat_id: string | null;
  enabled: boolean;
  created_at: Date;
}): RuleRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    kind: row.kind,
    threshold: row.threshold,
    eventName: row.event_name,
    webhookUrl: row.webhook_url,
    telegramChatId: row.telegram_chat_id,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listRules(contractId: string) {
  const rows = await getDb()`select * from alert_rules where contract_id = ${contractId} order by created_at desc`;
  return rows.map((row) => mapRule(row as never));
}

export async function getRule(id: string) {
  const rows = await getDb()`select * from alert_rules where id = ${id}`;
  return rows[0] ? mapRule(rows[0] as never) : null;
}

export async function createRule(input: {
  contractId: string;
  kind: string;
  threshold: string | null;
  eventName: string | null;
  webhookUrl: string | null;
  telegramChatId: string | null;
}) {
  const id = crypto.randomUUID();
  await getDb()`
    insert into alert_rules (id, contract_id, kind, threshold, event_name, webhook_url, telegram_chat_id)
    values (
      ${id}, ${input.contractId}, ${input.kind}, ${input.threshold}, ${input.eventName}, ${input.webhookUrl}, ${input.telegramChatId}
    )
  `;
  return (await getRule(id))!;
}

export async function hasFire(ruleId: string, eventId: string) {
  const rows = await getDb()`select 1 from alert_fires where rule_id = ${ruleId} and event_id = ${eventId} limit 1`;
  return rows.length > 0;
}

export async function insertFire(input: {
  ruleId: string;
  contractId: string;
  eventId: string | null;
  payload: unknown;
  webhookStatus: string;
  telegramStatus: string;
  backfill: boolean;
}) {
  await getDb()`
    insert into alert_fires (id, rule_id, contract_id, event_id, payload, webhook_status, telegram_status, backfill)
    values (
      ${crypto.randomUUID()}, ${input.ruleId}, ${input.contractId}, ${input.eventId}, ${getDb().json(input.payload as never)},
      ${input.webhookStatus}, ${input.telegramStatus}, ${input.backfill}
    )
  `;
}

export async function listFires(contractId: string) {
  const rows = await getDb()`
    select * from alert_fires where contract_id = ${contractId} order by created_at desc limit 30
  `;
  return rows.map((row) => ({
    id: String(row.id),
    ruleId: String(row.rule_id),
    eventId: row.event_id ? String(row.event_id) : null,
    payload: row.payload,
    webhookStatus: row.webhook_status ? String(row.webhook_status) : null,
    telegramStatus: row.telegram_status ? String(row.telegram_status) : null,
    backfill: row.backfill === true,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export async function insertInbox(body: unknown, headers: unknown) {
  await initDb();
  await getDb()`
    insert into webhook_inbox (id, body, headers) values (${crypto.randomUUID()}, ${getDb().json(body as never)}, ${getDb().json(headers as never)})
  `;
}

export async function listInbox() {
  await initDb();
  const rows = await getDb()`select * from webhook_inbox order by received_at desc limit 40`;
  return rows.map((row) => ({
    id: String(row.id),
    receivedAt: (row.received_at as Date).toISOString(),
    body: row.body,
  }));
}

export async function findByAddress(chainId: number, address: string) {
  await initDb();
  const rows = await getDb()<ContractRow[]>`
    select * from contracts where chain_id = ${chainId} and lower(address) = ${address.toLowerCase()}
  `;
  return rows[0] ? mapContract(rows[0]) : null;
}
