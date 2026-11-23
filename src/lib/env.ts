function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function env() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://fathom:fathom@127.0.0.1:5432/fathom",
    etherscanKey: process.env.ETHERSCAN_API_KEY?.trim() ?? "",
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    blockRange: clamp(integer(process.env.INDEX_BLOCK_RANGE, 80), 20, 5_000),
    maxLogs: clamp(integer(process.env.INDEX_MAX_LOGS, 100), 1, 1_000),
    chunkSize: clamp(integer(process.env.INDEX_CHUNK_SIZE, 15), 1, 200),
    heimdallTimeoutMs: clamp(integer(process.env.HEIMDALL_TIMEOUT_MS, 90_000), 5_000, 180_000),
  };
}
