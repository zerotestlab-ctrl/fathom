import { isChainId } from "@/lib/chains";
import { enqueueWatch, listContracts } from "@/lib/db";
import { env } from "@/lib/env";
import { failure, json } from "@/lib/http";
import { assertAddress } from "@/lib/pipeline";
import { startWorker } from "@/lib/worker";

export async function GET() {
  try {
    return json({ contracts: await listContracts() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    startWorker();
    const body = (await request.json()) as { address?: string; chainId?: number; blockRange?: number; refresh?: boolean };
    const chainId = Number(body.chainId);
    if (!isChainId(chainId)) throw new Error("Choose Ethereum, Arbitrum One, or Base.");
    const address = assertAddress(String(body.address ?? ""));
    const requested = Number(body.blockRange ?? env().blockRange);
    const blockRange = Math.min(5_000, Math.max(20, Number.isFinite(requested) ? requested : env().blockRange));
    const contract = await enqueueWatch({ chainId, address, blockRange, refresh: body.refresh === true });
    return json({ contract }, 202);
  } catch (error) {
    return failure(error);
  }
}
