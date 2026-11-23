import { canonicalSignature, selectorFor } from "@/lib/abi/signature";
import type { AbiParam, TaggedAbiItem } from "@/lib/abi/types";

type KnownEvent = {
  name: string;
  inputs: AbiParam[];
};

const KNOWN_EVENT_DEFS: KnownEvent[] = [
  {
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    name: "OwnershipTransferred",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    name: "OwnershipTransferStarted",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    name: "Upgraded",
    inputs: [{ name: "implementation", type: "address", indexed: true }],
  },
  {
    name: "AdminChanged",
    inputs: [
      { name: "previousAdmin", type: "address", indexed: false },
      { name: "newAdmin", type: "address", indexed: false },
    ],
  },
  {
    name: "BeaconUpgraded",
    inputs: [{ name: "beacon", type: "address", indexed: true }],
  },
  {
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    name: "Initialized",
    inputs: [{ name: "version", type: "uint64", indexed: false }],
  },
  {
    name: "Deposit",
    inputs: [
      { name: "dst", type: "address", indexed: true },
      { name: "wad", type: "uint256", indexed: false },
    ],
  },
  {
    name: "Withdrawal",
    inputs: [
      { name: "src", type: "address", indexed: true },
      { name: "wad", type: "uint256", indexed: false },
    ],
  },
  {
    name: "TransferSingle",
    inputs: [
      { name: "operator", type: "address", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "id", type: "uint256", indexed: false },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    name: "ApprovalForAll",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "operator", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
    ],
  },
  {
    name: "Paused",
    inputs: [{ name: "account", type: "address", indexed: false }],
  },
  {
    name: "Unpaused",
    inputs: [{ name: "account", type: "address", indexed: false }],
  },
];

const KNOWN_FUNCTION_SIGNATURES = [
  "transfer(address,uint256)",
  "transferFrom(address,address,uint256)",
  "approve(address,uint256)",
  "balanceOf(address)",
  "allowance(address,address)",
  "totalSupply()",
  "name()",
  "symbol()",
  "decimals()",
  "owner()",
  "renounceOwnership()",
  "transferOwnership(address)",
  "upgradeTo(address)",
  "upgradeToAndCall(address,bytes)",
  "implementation()",
  "admin()",
  "changeAdmin(address)",
  "proxiableUUID()",
  "initialize()",
  "mint(address,uint256)",
  "burn(address,uint256)",
  "burn(uint256)",
  "deposit()",
  "withdraw(uint256)",
  "masterCopy()",
  "facetAddresses()",
  "facets()",
];

function eventItem(def: KnownEvent): TaggedAbiItem {
  const signature = canonicalSignature(def.name, def.inputs);
  return {
    type: "event",
    name: def.name,
    signature,
    selector: selectorFor("event", signature),
    inputs: def.inputs,
    outputs: [],
    anonymous: false,
    confidence: "recovered",
    source: "builtin-signatures",
  };
}

function functionItem(signature: string): TaggedAbiItem | null {
  const open = signature.indexOf("(");
  if (open < 0) return null;
  const name = signature.slice(0, open);
  const types = signature
    .slice(open + 1, -1)
    .split(",")
    .filter(Boolean);
  const inputs = types.map((type, index) => ({ name: `arg${index}`, type, indexed: false }));
  return {
    type: "function",
    name,
    signature,
    selector: selectorFor("function", signature),
    inputs,
    outputs: [],
    stateMutability: "nonpayable",
    confidence: "recovered",
    source: "builtin-signatures",
  };
}

const events = KNOWN_EVENT_DEFS.map(eventItem);
const functions = KNOWN_FUNCTION_SIGNATURES.map(functionItem).filter((item): item is TaggedAbiItem => item !== null);

const eventsByTopic = new Map(events.map((item) => [item.selector, item]));
const functionsBySelector = new Map(functions.map((item) => [item.selector, item]));

export function knownEventByTopic(topic: string): TaggedAbiItem | null {
  return eventsByTopic.get(topic.toLowerCase()) ?? null;
}

export function knownFunctionBySelector(selector: string): TaggedAbiItem | null {
  return functionsBySelector.get(selector.toLowerCase()) ?? null;
}

export function knownEvents(): TaggedAbiItem[] {
  return events;
}
