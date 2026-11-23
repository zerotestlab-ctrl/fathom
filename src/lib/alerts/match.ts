export type AlertKind = "large_transfer" | "ownership_change" | "mint" | "proxy_upgrade" | "any_event";

export type AlertRuleInput = {
  kind: AlertKind;
  threshold?: string | null;
  eventName?: string | null;
};

export type MatchableEvent = {
  eventName: string;
  args: Record<string, unknown>;
};

const ZERO = `0x${"0".repeat(40)}`;
const VALUE_KEYS = ["value", "amount", "wad", "tokens"];
const FROM_KEYS = ["from", "src", "_from", "sender"];
const OWNER_EVENTS = new Set([
  "OwnershipTransferred",
  "OwnershipTransferStarted",
  "AdminChanged",
  "RoleGranted",
  "RoleRevoked",
  "RoleAdminChanged",
  "NewAdmin",
  "GovernorshipTransferred",
]);
const UPGRADE_EVENTS = new Set(["Upgraded", "BeaconUpgraded", "DiamondCut"]);

function addressArg(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  }
  return null;
}

function valueArg(args: Record<string, unknown>): bigint | null {
  for (const key of VALUE_KEYS) {
    const value = args[key];
    if (typeof value === "string" && /^\d+$/.test(value)) {
      try {
        return BigInt(value);
      } catch {
        return null;
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  }
  return null;
}

export function matchRule(rule: AlertRuleInput, event: MatchableEvent): boolean {
  if (rule.eventName && rule.eventName !== event.eventName) return false;
  if (rule.kind === "any_event") return true;
  if (rule.kind === "large_transfer") {
    if (event.eventName !== "Transfer" && event.eventName !== "TransferSingle") return false;
    const amount = valueArg(event.args);
    if (amount === null) return false;
    const threshold = rule.threshold && /^\d+$/.test(rule.threshold) ? BigInt(rule.threshold) : 0n;
    return amount >= threshold;
  }
  if (rule.kind === "mint") {
    if (/^mint/i.test(event.eventName)) return true;
    if (event.eventName !== "Transfer" && event.eventName !== "TransferSingle") return false;
    return addressArg(event.args, FROM_KEYS) === ZERO;
  }
  if (rule.kind === "ownership_change") return OWNER_EVENTS.has(event.eventName);
  if (rule.kind === "proxy_upgrade") return UPGRADE_EVENTS.has(event.eventName);
  return false;
}
