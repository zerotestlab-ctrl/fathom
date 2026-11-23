import { canonicalSignature, parseSignature, selectorFor } from "@/lib/abi/signature";
import { confidenceRank, type AbiKind, type AbiParam, type Confidence, type TaggedAbiItem } from "@/lib/abi/types";

const UNRESOLVED_NAME = /^(?:unresolved|unknown|function|sel)_([0-9a-fA-F]{8})$/i;
const UNRESOLVED_EVENT = /^Event_([0-9a-fA-F]{64})$/i;

function asParams(value: unknown): AbiParam[] {
  if (!Array.isArray(value)) return [];
  const params: AbiParam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (!type) continue;
    params.push({
      name: typeof record.name === "string" && record.name ? record.name : `arg${params.length}`,
      type,
      indexed: record.indexed === true,
      components: asParams(record.components),
    });
  }
  return params;
}

function quality(item: TaggedAbiItem): number {
  let score = confidenceRank(item.confidence) * 10;
  if (item.inputs.length) score += 1;
  if (item.inputs.some((input) => input.name && !/^arg\d+$/.test(input.name))) score += 2;
  if (item.inputs.some((input) => input.indexed)) score += 1;
  if (item.signature && !item.name.startsWith("sel_") && !UNRESOLVED_NAME.test(item.name)) score += 1;
  return score;
}

export function itemKey(item: TaggedAbiItem): string {
  if (item.selector) return `${item.type}:${item.selector.toLowerCase()}`;
  return `${item.type}:${item.signature}`;
}

export function mergeAbi(items: TaggedAbiItem[]): TaggedAbiItem[] {
  const map = new Map<string, TaggedAbiItem>();
  const ordered = [...items].sort((a, b) => quality(a) - quality(b));
  for (const item of ordered) {
    const key = itemKey(item);
    const previous = map.get(key);
    if (!previous || quality(item) >= quality(previous)) map.set(key, item);
  }
  return [...map.values()].sort(compareItems);
}

function compareItems(a: TaggedAbiItem, b: TaggedAbiItem): number {
  const order: AbiKind[] = ["event", "function", "error", "constructor", "fallback", "receive"];
  const kind = order.indexOf(a.type) - order.indexOf(b.type);
  if (kind !== 0) return kind;
  return a.signature.localeCompare(b.signature) || a.name.localeCompare(b.name);
}

export function guessedSelector(selector: string): TaggedAbiItem {
  const normalized = selector.toLowerCase();
  return {
    type: "function",
    name: `sel_${normalized.slice(2)}`,
    signature: "",
    selector: normalized,
    inputs: [],
    outputs: [],
    confidence: "guessed",
    source: "bytecode-selector",
  };
}

export function guessedTopic(topic: string): TaggedAbiItem {
  const normalized = topic.toLowerCase();
  const short = normalized.slice(2, 10);
  return {
    type: "event",
    name: `Unknown_${short}`,
    signature: "",
    selector: normalized,
    inputs: [],
    outputs: [],
    anonymous: false,
    confidence: "guessed",
    source: "log-topic",
  };
}

export function fromSignature(
  kind: "function" | "event",
  signature: string,
  confidence: Confidence,
  source: string,
): TaggedAbiItem | null {
  const parsed = parseSignature(signature);
  if (!parsed) return null;
  const canonical = canonicalSignature(parsed.name, parsed.inputs);
  return {
    type: kind,
    name: parsed.name,
    signature: canonical,
    selector: selectorFor(kind, canonical),
    inputs: parsed.inputs,
    outputs: [],
    stateMutability: kind === "function" ? "nonpayable" : undefined,
    anonymous: kind === "event" ? false : undefined,
    confidence,
    source,
  };
}

function unresolvedSelector(name: string, explicit: unknown): string {
  if (typeof explicit === "string" && /^0x[0-9a-fA-F]{8}$/.test(explicit)) return explicit.toLowerCase();
  const match = name.match(UNRESOLVED_NAME);
  return match ? `0x${match[1].toLowerCase()}` : "";
}

export function tagStandardAbi(raw: unknown, confidence: Confidence, source: string): TaggedAbiItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const items: TaggedAbiItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const type = record.type;
    if (
      type !== "function" &&
      type !== "event" &&
      type !== "error" &&
      type !== "constructor" &&
      type !== "fallback" &&
      type !== "receive"
    ) {
      continue;
    }
    const name = typeof record.name === "string" ? record.name : type === "constructor" ? "constructor" : type;
    const inputs = asParams(record.inputs);
    const outputs = asParams(record.outputs);
    const anonymous = record.anonymous === true;
    const eventTopic = name.match(UNRESOLVED_EVENT);
    const unresolved = eventTopic ? `0x${eventTopic[1].toLowerCase()}` : unresolvedSelector(name, record.selector);
    const looksUnresolved = Boolean(eventTopic) || UNRESOLVED_NAME.test(name) || name === "";
    const displayName = eventTopic
      ? `Unknown_${eventTopic[1].slice(0, 8).toLowerCase()}`
      : looksUnresolved && unresolved
        ? `sel_${unresolved.slice(2, 10)}`
        : name;
    const signature =
      looksUnresolved && !inputs.length ? "" : canonicalSignature(displayName || type, inputs);
    let selector = unresolved;
    if (!selector && !looksUnresolved && signature && !anonymous && (type === "function" || type === "event" || type === "error")) {
      selector = selectorFor(type, signature);
    }
    const itemConfidence: Confidence = looksUnresolved && confidence !== "verified" ? "guessed" : confidence;
    items.push({
      type,
      name: displayName,
      signature,
      selector,
      inputs,
      outputs,
      stateMutability: typeof record.stateMutability === "string" ? record.stateMutability : undefined,
      anonymous: type === "event" ? anonymous : undefined,
      confidence: itemConfidence,
      source,
    });
  }
  return items;
}

export function toPlainAbi(items: TaggedAbiItem[]): Record<string, unknown>[] {
  return items
    .filter((item) => item.confidence !== "guessed" || item.inputs.length > 0)
    .map((item) => {
      const base: Record<string, unknown> = {
        type: item.type,
        name: item.name,
        inputs: item.inputs.map((input) => ({
          name: input.name,
          type: input.type,
          indexed: input.indexed === true,
          ...(input.components ? { components: input.components } : {}),
        })),
      };
      if (item.type === "function" || item.type === "error" || item.type === "constructor") {
        base.outputs = item.outputs;
        if (item.stateMutability) base.stateMutability = item.stateMutability;
      }
      if (item.type === "event") base.anonymous = item.anonymous === true;
      if (item.type === "fallback" || item.type === "receive") {
        delete base.name;
        delete base.inputs;
        if (item.stateMutability) base.stateMutability = item.stateMutability;
      }
      return base;
    });
}
