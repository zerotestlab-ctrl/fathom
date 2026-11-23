import { decodeEventLog, type Hex } from "viem";
import type { AbiParam, TaggedAbiItem } from "@/lib/abi/types";

export type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedLog = {
  eventName: string;
  signature: string;
  selector: string;
  confidence: TaggedAbiItem["confidence"];
  args: Record<string, unknown>;
};

function isDynamic(type: string): boolean {
  if (type === "string" || type === "bytes") return true;
  if (type.endsWith("[]")) return true;
  if (type.startsWith("tuple")) return true;
  return false;
}

function combinations(count: number, take: number): number[][] {
  const out: number[][] = [];
  const current: number[] = [];
  const walk = (start: number) => {
    if (current.length === take) {
      out.push([...current]);
      return;
    }
    for (let index = start; index < count; index++) {
      current.push(index);
      walk(index + 1);
      current.pop();
    }
  };
  walk(0);
  return out;
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/^\d+$/.test(key)) continue;
      out[key] = serialize(inner);
    }
    return out;
  }
  return value;
}

function tryDecode(name: string, inputs: AbiParam[], log: RawLog): Record<string, unknown> | null {
  if (!log.topics[0] || !log.data) return null;
  try {
    const decoded = decodeEventLog({
      abi: [
        {
          type: "event",
          name,
          inputs,
          anonymous: false,
        },
      ],
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    });
    const args = serialize(decoded.args);
    return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function decodeItem(item: TaggedAbiItem, log: RawLog): Record<string, unknown> | null {
  const indexedCount = Math.max(0, log.topics.length - 1);
  if (item.confidence === "verified" || item.inputs.some((input) => input.indexed)) {
    const direct = tryDecode(item.name, item.inputs, log);
    if (direct) return direct;
    if (item.confidence === "verified") return null;
  }
  if (indexedCount > item.inputs.length || indexedCount > 3 || !item.inputs.length) {
    return indexedCount === 0 ? tryDecode(item.name, item.inputs, log) : null;
  }
  for (const combo of combinations(item.inputs.length, indexedCount)) {
    const chosen = new Set(combo);
    if ([...chosen].some((index) => isDynamic(item.inputs[index]?.type ?? ""))) continue;
    const inputs = item.inputs.map((input, index) => ({ ...input, indexed: chosen.has(index) }));
    const decoded = tryDecode(item.name, inputs, log);
    if (decoded) return decoded;
  }
  return null;
}

export function decodeLog(log: RawLog, items: TaggedAbiItem[]): DecodedLog {
  const topic = (log.topics[0] ?? "").toLowerCase();
  const candidates = items
    .filter((item) => item.type === "event" && item.selector.toLowerCase() === topic && item.name)
    .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "verified" ? -1 : 1));

  for (const item of candidates) {
    if (item.confidence === "guessed" && item.inputs.length === 0) continue;
    const args = decodeItem(item, log);
    if (!args) continue;
    return {
      eventName: item.name,
      signature: item.signature,
      selector: topic,
      confidence: item.confidence,
      args,
    };
  }

  const short = topic.startsWith("0x") ? topic.slice(2, 10) : "unknown";
  return {
    eventName: `Unknown_${short}`,
    signature: "",
    selector: topic,
    confidence: "guessed",
    args: {},
  };
}
