import { matchRule, type AlertKind } from "@/lib/alerts/match";
import { CHAINS, explorerTx, type ChainId } from "@/lib/chains";
import { getContract, hasFire, insertFire, listEvents, listRules, type RuleRow, type StoredEvent } from "@/lib/db";
import { env } from "@/lib/env";

const KINDS = new Set<AlertKind>(["large_transfer", "ownership_change", "mint", "proxy_upgrade", "any_event"]);

export function isAlertKind(value: string): value is AlertKind {
  return KINDS.has(value as AlertKind);
}

function assertWebhook(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Webhook URL must start with http:// or https://");
  }
  if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
    throw new Error("That webhook host is not allowed");
  }
}

function payloadFor(rule: RuleRow, event: StoredEvent | null, backfill: boolean, sample = false) {
  return {
    source: "fathom",
    kind: rule.kind,
    backfill,
    sample,
    chainId: event?.chainId,
    address: event?.address,
    event: event
      ? {
          name: event.eventName,
          signature: event.signature,
          confidence: event.confidence,
          args: event.args,
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          logIndex: event.logIndex,
          explorer: explorerTx(event.chainId, event.txHash),
        }
      : null,
    firedAt: new Date().toISOString(),
  };
}

async function postWebhook(url: string, payload: unknown): Promise<string> {
  assertWebhook(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "fathom-alerts" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  return String(response.status);
}

async function sendTelegram(chatId: string, rule: RuleRow, event: StoredEvent | null): Promise<string> {
  const token = env().telegramToken;
  if (!token) return "skipped: TELEGRAM_BOT_TOKEN is not set";
  const chain = event ? (CHAINS[event.chainId as ChainId]?.name ?? String(event.chainId)) : "sample";
  const lines = [
    `Fathom ${rule.kind}`,
    event ? `${event.eventName} on ${chain}` : "Test alert",
    event?.address ?? "",
    event ? explorerTx(event.chainId, event.txHash) : "",
  ].filter(Boolean);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: lines.join("\n").slice(0, 3500) }),
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok ? "sent" : `HTTP ${response.status}`;
}

export async function deliver(rule: RuleRow, event: StoredEvent | null, backfill: boolean, sample = false) {
  if (event && (await hasFire(rule.id, event.id))) return false;
  const payload = payloadFor(rule, event, backfill, sample);
  let webhookStatus = "skipped";
  let telegramStatus = "skipped";
  if (rule.webhookUrl) {
    try {
      webhookStatus = await postWebhook(rule.webhookUrl, payload);
    } catch (error) {
      webhookStatus = `error: ${error instanceof Error ? error.message : "request failed"}`.slice(0, 180);
    }
  }
  if (rule.telegramChatId) {
    try {
      telegramStatus = await sendTelegram(rule.telegramChatId, rule, event);
    } catch {
      telegramStatus = "error";
    }
  }
  await insertFire({
    ruleId: rule.id,
    contractId: rule.contractId,
    eventId: event?.id ?? null,
    payload,
    webhookStatus,
    telegramStatus,
    backfill,
  });
  return true;
}

export async function deliverRuleMatches(contractId: string, options: { limit: number; backfill: boolean }) {
  const contract = await getContract(contractId);
  if (!contract) return;
  const rules = await listRules(contractId);
  const events = await listEvents(contractId, 300);
  for (const rule of rules) {
    if (!rule.enabled || !isAlertKind(rule.kind)) continue;
    let fired = 0;
    for (const event of events) {
      if (fired >= options.limit) break;
      const matched = matchRule(
        { kind: rule.kind, threshold: rule.threshold, eventName: rule.eventName },
        { eventName: event.eventName, args: event.args },
      );
      if (!matched) continue;
      if (await deliver(rule, event, options.backfill)) fired += 1;
    }
  }
}
