import { decodeFunctionResult, getAddress, isAddress, toFunctionSelector, type Hex } from "viem";
import { extractSelectors } from "@/lib/abi/selectors";
import {
  addressFromWord,
  detectClone,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  interpretSlots,
  OZ_LEGACY_IMPLEMENTATION_SLOT,
  type ProxyCandidate,
} from "@/lib/proxy/detect";

export type ChainReader = {
  getCode: (address: Hex) => Promise<Hex>;
  getStorageAt: (address: Hex, slot: Hex) => Promise<Hex>;
  call: (to: Hex, data: Hex) => Promise<Hex>;
};

export type ResolvedProxy = {
  isProxy: boolean;
  kind: string | null;
  implementation: string | null;
  admin: string | null;
  beacon: string | null;
  chain: string[];
  logicCode: Hex;
  facets: string[];
};

const IMPLEMENTATION = toFunctionSelector("implementation()");
const MASTER_COPY = toFunctionSelector("masterCopy()");
const FACET_ADDRESSES = toFunctionSelector("facetAddresses()");

const facetAbi = [
  {
    type: "function" as const,
    name: "facetAddresses",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
];

async function hasCode(reader: ChainReader, address: string): Promise<Hex | null> {
  if (!isAddress(address)) return null;
  const code = await reader.getCode(getAddress(address));
  if (!code || code === "0x" || code.length <= 2) return null;
  return code;
}

async function readAddressCall(reader: ChainReader, to: string, data: Hex): Promise<string | null> {
  try {
    const returned = await reader.call(getAddress(to), data);
    return addressFromWord(returned);
  } catch {
    return null;
  }
}

export async function resolveProxy(reader: ChainReader, address: string, code: Hex): Promise<ResolvedProxy> {
  const seen = new Set<string>([getAddress(address).toLowerCase()]);
  const hops: string[] = [];
  let currentAddress = getAddress(address);
  let currentCode = code;
  let outer: ProxyCandidate | null = null;
  let admin: string | null = null;
  let beacon: string | null = null;
  const facets = new Set<string>();

  for (let depth = 0; depth < 3; depth++) {
    const clone = detectClone(currentCode);
    let candidate = clone;
    if (!candidate) {
      const [implementationSlot, adminSlot, beaconSlot, legacySlot, slot0] = await Promise.all([
        reader.getStorageAt(currentAddress, EIP1967_IMPLEMENTATION_SLOT),
        reader.getStorageAt(currentAddress, EIP1967_ADMIN_SLOT),
        reader.getStorageAt(currentAddress, EIP1967_BEACON_SLOT),
        reader.getStorageAt(currentAddress, OZ_LEGACY_IMPLEMENTATION_SLOT),
        reader.getStorageAt(currentAddress, "0x0000000000000000000000000000000000000000000000000000000000000000"),
      ]);
      candidate = interpretSlots({
        bytecode: currentCode,
        implementationSlot,
        adminSlot,
        beaconSlot,
        legacySlot,
        slot0,
      });
      if (candidate?.kind === "eip1967-beacon" && candidate.beacon) {
        const impl = await readAddressCall(reader, candidate.beacon, IMPLEMENTATION);
        if (impl) candidate = { ...candidate, implementation: impl };
      }
      if (!candidate && currentCode.length < 2 + 500 * 2) {
        const called =
          (await readAddressCall(reader, currentAddress, IMPLEMENTATION)) ??
          (await readAddressCall(reader, currentAddress, MASTER_COPY));
        if (called) candidate = { kind: "slot0-implementation", implementation: called };
      }
    }

    if (!outer && candidate) {
      outer = candidate;
      admin = candidate.admin ?? null;
      beacon = candidate.beacon ?? null;
    }

    const next = candidate?.implementation;
    if (!next || seen.has(next.toLowerCase())) break;
    const nextCode = await hasCode(reader, next);
    if (!nextCode) break;
    seen.add(next.toLowerCase());
    hops.push(getAddress(next));
    currentAddress = getAddress(next);
    currentCode = nextCode;
    if (!detectClone(nextCode) && nextCode.length > 2 + 200 * 2) break;
  }

  if (currentCode.toLowerCase().includes(FACET_ADDRESSES.slice(2))) {
    try {
      const data = await reader.call(getAddress(address), FACET_ADDRESSES);
      const decoded = decodeFunctionResult({ abi: facetAbi, functionName: "facetAddresses", data }) as readonly string[];
      if (Array.isArray(decoded)) {
        for (const facet of decoded) {
          if (typeof facet === "string" && isAddress(facet)) facets.add(getAddress(facet));
        }
      }
    } catch {
      // Not a diamond, or the call reverted.
    }
  }

  const implementation = hops.at(-1) ?? null;
  return {
    isProxy: Boolean(outer && implementation),
    kind: outer?.kind ?? (facets.size ? "diamond" : null),
    implementation,
    admin,
    beacon,
    chain: hops,
    logicCode: implementation ? currentCode : code,
    facets: [...facets],
  };
}

export function selectorsFromCode(code: Hex): string[] {
  return extractSelectors(code);
}
