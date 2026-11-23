import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  decodeFunctionResult,
  getAddress,
  hexToString,
  http,
  isAddress,
  toFunctionSelector,
  type Hex,
} from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { decodeLog, type RawLog } from "@/lib/abi/decode";
import { mergeAbi, tagStandardAbi, toPlainAbi } from "@/lib/abi/merge";
import { extractSelectors } from "@/lib/abi/selectors";
import type { TaggedAbiItem } from "@/lib/abi/types";
import { deliverRuleMatches } from "@/lib/alerts/deliver";
import { CHAINS, isChainId, rpcUrlFor, type ChainId } from "@/lib/chains";
import {
  getContract,
  countEvents,
  insertEvents,
  listAbiItems,
  markIndexed,
  replaceAbi,
  saveAnalysis,
  setError,
  setProgress,
  type ContractView,
} from "@/lib/db";
import { env } from "@/lib/env";
import { decompileBytecode } from "@/lib/heimdall";
import { generatePonderProject } from "@/lib/indexer/ponder";
import { resolveProxy, type ChainReader } from "@/lib/proxy/resolve";
import { fetchEtherscanAbi, fetchSourcifyAbi, lookupSignatures } from "@/lib/sources";

const chains = { 1: mainnet, 42161: arbitrum, 8453: base } as const;
const stringAbi = [
  {
    type: "function" as const,
    name: "name",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "string" }],
  },
];
const bytesAbi = [
  {
    type: "function" as const,
    name: "name",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
];
const decimalsAbi = [
  {
    type: "function" as const,
    name: "decimals",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
];

function clientFor(chainId: ChainId) {
  return createPublicClient({
    chain: chains[chainId],
    transport: http(rpcUrlFor(chainId), { timeout: 20_000, retryCount: 2, retryDelay: 500 }),
  });
}

type ChainClient = ReturnType<typeof clientFor>;

function readerFor(client: ChainClient): ChainReader {
  return {
    async getCode(address) {
      return (await client.getBytecode({ address })) ?? "0x";
    },
    async getStorageAt(address, slot) {
      return (await client.getStorageAt({ address, slot })) ?? "0x";
    },
    async call(to, data) {
      const result = await client.call({ to, data });
      return result.data ?? "0x";
    },
  };
}

async function readString(client: ChainClient, address: Hex, data: Hex): Promise<string | null> {
  try {
    const result = await client.call({ to: address, data });
    if (!result.data || result.data === "0x") return null;
    try {
      const decoded = decodeFunctionResult({ abi: stringAbi, functionName: "name", data: result.data }) as string;
      return decoded.trim() ? decoded.trim() : null;
    } catch {
      const decoded = decodeFunctionResult({ abi: bytesAbi, functionName: "name", data: result.data }) as Hex;
      const text = hexToString(decoded).replace(/\u0000+$/g, "").trim();
      return text || null;
    }
  } catch {
    return null;
  }
}

function isRangeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /more than|block range|too many|timeout|exceed|query returned|response size|limit|10,?000|429/i.test(message);
}

async function collectLogs(
  client: ChainClient,
  address: Hex,
  fromBlock: bigint,
  toBlock: bigint,
  maxLogs: number,
): Promise<{ logs: RawLog[]; warnings: string[] }> {
  const warnings: string[] = [];
  const collected: RawLog[] = [];
  let cursor = toBlock;
  let chunk = BigInt(env().chunkSize);
  while (cursor >= fromBlock && collected.length < maxLogs) {
    const start = cursor - chunk + 1n < fromBlock ? fromBlock : cursor - chunk + 1n;
    try {
      const page = await client.getLogs({ address, fromBlock: start, toBlock: cursor });
      for (const log of page) {
        collected.push({
          address: log.address,
          topics: log.topics.filter((topic): topic is Hex => Boolean(topic)),
          data: log.data,
          blockNumber: log.blockNumber ?? start,
          transactionHash: log.transactionHash ?? "0x",
          logIndex: log.logIndex ?? 0,
        });
      }
      if (collected.length >= maxLogs) break;
      cursor = start - 1n;
      chunk = BigInt(Math.min(env().chunkSize, Number(chunk) * 2));
    } catch (error) {
      if (chunk <= 1n || !isRangeError(error)) {
        warnings.push(
          `Log query failed at block ${cursor.toString()}: ${error instanceof Error ? error.message : "RPC error"}`.slice(0, 280),
        );
        if (collected.length) break;
        throw error;
      }
      chunk = chunk / 2n;
    }
  }
  collected.sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);
  return { logs: collected.slice(0, maxLogs), warnings };
}

async function blockTimes(client: ChainClient, numbers: bigint[]): Promise<Map<string, bigint>> {
  const times = new Map<string, bigint>();
  const unique = [...new Set(numbers.map((number) => number.toString()))].map((value) => BigInt(value));
  let index = 0;
  async function worker() {
    while (index < unique.length) {
      const current = unique[index++];
      try {
        const block = await client.getBlock({ blockNumber: current });
        times.set(current.toString(), block.timestamp);
      } catch {
        // A missing timestamp still leaves the log in the table.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, () => worker()));
  return times;
}

async function writePonder(chainId: ChainId, address: string, files: Record<string, string>) {
  const dir = path.resolve("generated/ponder", `${chainId}-${address.toLowerCase()}`);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

function counts(items: TaggedAbiItem[]) {
  return {
    verified: items.filter((item) => item.confidence === "verified").length,
    recovered: items.filter((item) => item.confidence === "recovered").length,
    guessed: items.filter((item) => item.confidence === "guessed").length,
  };
}

export async function runWatch(id: string) {
  const contract = await getContract(id);
  if (!contract || !isChainId(contract.chainId)) return;
  try {
    await analyze(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Watch failed";
    await setError(id, message);
  }
}

async function analyze(contract: ContractView) {
  const chainId = contract.chainId as ChainId;
  const client = clientFor(chainId);
  await setProgress(contract.id, "analyzing", "Fetching bytecode");
  const code = (await client.getBytecode({ address: getAddress(contract.address) })) ?? "0x";
  if (code === "0x") throw new Error(`No contract code at this address on ${CHAINS[chainId].name}.`);

  await setProgress(contract.id, "analyzing", "Resolving proxy");
  const proxy = await resolveProxy(readerFor(client), contract.address, code);
  const logicAddress = proxy.implementation ?? contract.address;
  const warnings: string[] = [];

  await setProgress(contract.id, "analyzing", "Looking up verified ABIs");
  const verifiedChunks: unknown[] = [];
  const verifiedSources: string[] = [];
  const addresses = [...new Set([contract.address, logicAddress, ...proxy.facets.slice(0, 4)])];
  for (const address of addresses) {
    try {
      const abi = await fetchSourcifyAbi(chainId, address);
      if (abi) {
        verifiedChunks.push(...abi);
        verifiedSources.push(`sourcify:${address}`);
      }
    } catch (error) {
      warnings.push(`Sourcify lookup failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  if (env().etherscanKey) {
    try {
      const abi = await fetchEtherscanAbi(chainId, logicAddress);
      if (abi) {
        verifiedChunks.push(...abi);
        verifiedSources.push("etherscan");
      }
    } catch (error) {
      warnings.push(`Etherscan lookup failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
  } else {
    warnings.push("ETHERSCAN_API_KEY is unset, so verified ABI lookup uses Sourcify only.");
  }

  const selectorSet = new Set(extractSelectors(proxy.logicCode));
  for (const facet of proxy.facets.slice(0, 6)) {
    const facetCode = await client.getBytecode({ address: getAddress(facet) });
    if (facetCode) for (const selector of extractSelectors(facetCode)) selectorSet.add(selector);
  }
  const lookedUp = await lookupSignatures("function", [...selectorSet]);
  if (lookedUp.warning) warnings.push(`OpenChain function lookup: ${lookedUp.warning}`);

  let heimdallItems: TaggedAbiItem[] = [];
  let decompiled: string | null = null;
  let heimdall: { status: string; message: string; durationMs: number } = {
    status: "skipped",
    message: verifiedSources.length ? "Skipped because a verified ABI was found." : "Not run",
    durationMs: 0,
  };
  if (!verifiedSources.length) {
    await setProgress(contract.id, "analyzing", "Decompiling with heimdall");
    const result = await decompileBytecode(proxy.logicCode);
    heimdall = { status: result.status, message: result.message, durationMs: result.durationMs };
    decompiled = result.source;
    heimdallItems = tagStandardAbi(result.abi, "recovered", "heimdall");
    if (result.status !== "done") warnings.push(result.message);
  }

  let items = mergeAbi([
    ...lookedUp.items,
    ...heimdallItems,
    ...tagStandardAbi(verifiedChunks, "verified", verifiedSources[0]?.split(":")[0] ?? "verified"),
  ]);

  const tokenName = await readString(client, getAddress(logicAddress), toFunctionSelector("name()"));
  const symbol = await readString(client, getAddress(logicAddress), toFunctionSelector("symbol()"));
  let decimals: number | null = null;
  try {
    const result = await client.call({ to: getAddress(logicAddress), data: toFunctionSelector("decimals()") });
    if (result.data && result.data !== "0x") {
      decimals = Number(decodeFunctionResult({ abi: decimalsAbi, functionName: "decimals", data: result.data }));
    }
  } catch {
    decimals = null;
  }

  const head = await client.getBlockNumber();
  const fromBlock = head > BigInt(contract.blockRange) ? head - BigInt(contract.blockRange) : 0n;
  const abiSource = verifiedSources.length
    ? verifiedSources.some((source) => source.startsWith("sourcify"))
      ? "sourcify"
      : "etherscan"
    : heimdallItems.some((item) => item.confidence === "recovered")
      ? "heimdall"
      : "recovered";
  const ponderFiles = generatePonderProject({
    chainId,
    address: getAddress(contract.address),
    startBlock: Number(fromBlock),
    endBlock: Number(head),
    items,
  });
  await writePonder(chainId, contract.address, ponderFiles);

  const meta = {
    bytecodeBytes: (code.length - 2) / 2,
    logicBytecodeBytes: (proxy.logicCode.length - 2) / 2,
    tokenName,
    symbol,
    decimals,
    warnings,
    heimdall,
    facets: proxy.facets,
    proxyChain: proxy.chain,
    verifiedSources,
    abiCounts: counts(items),
    ponderDir: `generated/ponder/${chainId}-${contract.address.toLowerCase()}`,
  };
  await saveAnalysis({
    id: contract.id,
    displayName: symbol && tokenName ? `${symbol} · ${tokenName}` : symbol || tokenName,
    isProxy: proxy.isProxy || proxy.facets.length > 0,
    proxyKind: proxy.kind,
    implementation: proxy.implementation,
    adminAddress: proxy.admin,
    abiSource,
    abi: toPlainAbi(items),
    meta,
    fromBlock,
    toBlock: head,
    headBlock: head,
    decompiled,
    ponderFiles,
    items,
  });

  await setProgress(contract.id, "indexing", `Indexing ${contract.blockRange} blocks`);
  const { logs, warnings: logWarnings } = await collectLogs(
    client,
    getAddress(contract.address),
    fromBlock,
    head,
    env().maxLogs,
  );
  warnings.push(...logWarnings);
  items = await enrichEvents(items, logs, warnings);
  meta.warnings = warnings;
  meta.abiCounts = counts(items);
  await replaceAbi(contract.id, items, toPlainAbi(items), meta);
  await persistLogs(contract, items, logs, client);
  await markIndexed(contract.id, await countEvents(contract.id), head);
  await deliverRuleMatches(contract.id, { limit: 5, backfill: true });
}

async function enrichEvents(items: TaggedAbiItem[], logs: RawLog[], warnings: string[]) {
  const known = new Set(items.filter((item) => item.type === "event" && item.selector).map((item) => item.selector.toLowerCase()));
  const topics = [...new Set(logs.map((log) => log.topics[0]?.toLowerCase()).filter((topic): topic is string => Boolean(topic)))].filter(
    (topic) => !known.has(topic),
  );
  if (!topics.length) return items;
  const lookedUp = await lookupSignatures("event", topics);
  if (lookedUp.warning) warnings.push(`OpenChain event lookup: ${lookedUp.warning}`);
  return mergeAbi([...items, ...lookedUp.items]);
}

async function persistLogs(contract: ContractView, items: TaggedAbiItem[], logs: RawLog[], client: ChainClient) {
  const times = await blockTimes(
    client,
    logs.map((log) => log.blockNumber),
  );
  await insertEvents(
    logs.map((log) => {
      const decoded = decodeLog(log, items);
      return {
        id: `${contract.chainId}:${log.transactionHash}:${log.logIndex}`,
        contractId: contract.id,
        chainId: contract.chainId,
        address: getAddress(contract.address),
        eventName: decoded.eventName,
        signature: decoded.signature,
        confidence: decoded.confidence,
        args: decoded.args,
        topics: log.topics,
        data: log.data,
        blockNumber: log.blockNumber,
        blockTimestamp: times.get(log.blockNumber.toString()) ?? null,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      };
    }),
  );
}

export async function tailContract(contract: ContractView) {
  if (!isChainId(contract.chainId) || !contract.headBlock) return;
  const client = clientFor(contract.chainId);
  const head = await client.getBlockNumber();
  const stored = BigInt(contract.headBlock);
  if (head <= stored) return;
  const fromBlock = head - stored > 40n ? head - 40n : stored + 1n;
  const { logs } = await collectLogs(client, getAddress(contract.address), fromBlock, head, 40);
  const detail = await listAbiItems(contract.id);
  const items: TaggedAbiItem[] = detail.map((item) => ({
    type: item.kind as TaggedAbiItem["type"],
    name: item.name,
    signature: item.signature,
    selector: item.selector ?? "",
    inputs: Array.isArray(item.inputs) ? (item.inputs as TaggedAbiItem["inputs"]) : [],
    outputs: [],
    stateMutability: item.stateMutability ?? undefined,
    anonymous: item.anonymous,
    confidence: item.confidence as TaggedAbiItem["confidence"],
    source: item.source,
  }));
  await persistLogs(contract, items, logs, client);
  await markIndexed(contract.id, await countEvents(contract.id), head);
  await deliverRuleMatches(contract.id, { limit: 5, backfill: false });
}

export function assertAddress(value: string): Hex {
  if (!isAddress(value)) throw new Error("Enter a valid EVM address.");
  return getAddress(value);
}
