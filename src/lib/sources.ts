import { fromSignature, guessedSelector, guessedTopic } from "@/lib/abi/merge";
import { knownEventByTopic, knownFunctionBySelector } from "@/lib/abi/known";
import type { TaggedAbiItem } from "@/lib/abi/types";
import { env } from "@/lib/env";

async function readJson(url: string, timeoutMs = 12_000): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (response.status === 404) return { status: 404, json: null };
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return { status: response.status, json: await response.json() };
}

export async function fetchSourcifyAbi(chainId: number, address: string): Promise<unknown[] | null> {
  const { status, json } = await readJson(
    `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=abi`,
  );
  if (status === 404 || !json || typeof json !== "object") return null;
  const abi = (json as { abi?: unknown }).abi;
  return Array.isArray(abi) ? abi : null;
}

export async function fetchEtherscanAbi(chainId: number, address: string): Promise<unknown[] | null> {
  const key = env().etherscanKey;
  if (!key) return null;
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getabi");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", key);
  const { json } = await readJson(url.toString());
  if (!json || typeof json !== "object") return null;
  const result = (json as { status?: string; result?: unknown }).result;
  if ((json as { status?: string }).status !== "1") return null;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(result) ? result : null;
}

type OpenChainMatch = { name?: string; filtered?: boolean };

export async function lookupSignatures(
  kind: "function" | "event",
  ids: string[],
): Promise<{ items: TaggedAbiItem[]; warning?: string }> {
  const items: TaggedAbiItem[] = [];
  const missing: string[] = [];
  for (const id of [...new Set(ids.map((value) => value.toLowerCase()))]) {
    const known = kind === "function" ? knownFunctionBySelector(id) : knownEventByTopic(id);
    if (known) items.push({ ...known });
    else missing.push(id);
  }
  const warnings: string[] = [];
  for (let offset = 0; offset < missing.length; offset += 40) {
    const batch = missing.slice(offset, offset + 40);
    const url = `https://api.openchain.xyz/signature-database/v1/lookup?${kind}=${batch.join(",")}&filter=true`;
    try {
      const { json } = await readJson(url);
      const table =
        json && typeof json === "object"
          ? ((json as { result?: Record<string, Record<string, OpenChainMatch[] | null>> }).result?.[kind] ?? {})
          : {};
      for (const id of batch) {
        const matches = table[id] ?? [];
        const signature = (matches ?? []).find((match) => match?.name && match.filtered !== true)?.name;
        const recovered = signature ? fromSignature(kind, signature, "recovered", "openchain") : null;
        items.push(recovered ?? (kind === "function" ? guessedSelector(id) : guessedTopic(id)));
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Signature lookup failed");
      for (const id of batch) items.push(kind === "function" ? guessedSelector(id) : guessedTopic(id));
    }
  }
  return { items, warning: warnings[0] };
}
