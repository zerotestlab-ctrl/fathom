import { isChainId } from "@/lib/chains";
import { findByAddress, listEvents } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { assertAddress } from "@/lib/pipeline";

export async function GET(request: Request, context: { params: Promise<{ chainId: string; address: string }> }) {
  try {
    const params = await context.params;
    const chainId = Number(params.chainId);
    if (!isChainId(chainId)) return json({ error: "Unsupported chain" }, 400);
    const address = assertAddress(params.address);
    const contract = await findByAddress(chainId, address);
    if (!contract) return json({ error: "Contract is not on the watchlist." }, 404);
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const eventName = url.searchParams.get("event");
    const events = (await listEvents(contract.id, limit)).filter((event) => !eventName || event.eventName === eventName);
    return json({ address, chainId, events });
  } catch (error) {
    return failure(error);
  }
}
