import { getAddress, isAddress, keccak256, toBytes, toHex, type Hex } from "viem";

export type ProxyKind =
  | "eip1167"
  | "eip1167-solady"
  | "eip1967"
  | "eip1967-beacon"
  | "oz-legacy"
  | "slot0-implementation";

export type ProxyCandidate = {
  kind: ProxyKind;
  implementation?: string;
  admin?: string;
  beacon?: string;
};

export function eip1967Slot(label: string): Hex {
  const hash = BigInt(keccak256(toBytes(label)));
  return toHex(hash - 1n, { size: 32 });
}

export const EIP1967_IMPLEMENTATION_SLOT = eip1967Slot("eip1967.proxy.implementation");
export const EIP1967_ADMIN_SLOT = eip1967Slot("eip1967.proxy.admin");
export const EIP1967_BEACON_SLOT = eip1967Slot("eip1967.proxy.beacon");
export const OZ_LEGACY_IMPLEMENTATION_SLOT = keccak256(toBytes("org.zeppelinos.proxy.implementation"));

export function addressFromWord(word: string | null | undefined): string | null {
  if (!word || word === "0x") return null;
  const hex = word.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const address = `0x${hex.slice(24)}`;
  if (!isAddress(address) || /^0x0{40}$/.test(address)) return null;
  return getAddress(address);
}

function checksum(address: string): string | null {
  if (!isAddress(address)) return null;
  return getAddress(address);
}

export function detectClone(bytecode: string): ProxyCandidate | null {
  const hex = bytecode.toLowerCase().replace(/^0x/, "");
  const patterns: { kind: ProxyKind; prefix: string; suffix: string }[] = [
    {
      kind: "eip1167",
      prefix: "363d3d373d3d3d363d73",
      suffix: "5af43d82803e903d91602b57fd5bf3",
    },
    {
      kind: "eip1167-solady",
      prefix: "3d3d3d3d363d3d37363d73",
      suffix: "5af43d3d93803e602a57fd5bf3",
    },
  ];
  for (const pattern of patterns) {
    if (!hex.startsWith(pattern.prefix)) continue;
    const address = checksum(`0x${hex.slice(pattern.prefix.length, pattern.prefix.length + 40)}`);
    const rest = hex.slice(pattern.prefix.length + 40);
    if (!address || !rest.startsWith(pattern.suffix)) continue;
    return { kind: pattern.kind, implementation: address };
  }
  return null;
}

export function interpretSlots(input: {
  bytecode: string;
  implementationSlot: string | null;
  adminSlot: string | null;
  beaconSlot: string | null;
  legacySlot: string | null;
  slot0: string | null;
}): ProxyCandidate | null {
  const implementation = addressFromWord(input.implementationSlot);
  const admin = addressFromWord(input.adminSlot);
  const beacon = addressFromWord(input.beaconSlot);
  const legacy = addressFromWord(input.legacySlot);
  const slot0 = addressFromWord(input.slot0);
  if (implementation) return { kind: "eip1967", implementation, admin: admin ?? undefined };
  if (beacon) return { kind: "eip1967-beacon", beacon, admin: admin ?? undefined };
  if (legacy) return { kind: "oz-legacy", implementation: legacy, admin: admin ?? undefined };
  const byteLength = Math.max(0, input.bytecode.replace(/^0x/, "").length / 2);
  if (slot0 && byteLength > 0 && byteLength < 200) {
    return { kind: "slot0-implementation", implementation: slot0 };
  }
  return null;
}
