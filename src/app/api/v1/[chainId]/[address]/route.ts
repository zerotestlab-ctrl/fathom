import { isChainId } from "@/lib/chains";
import { findByAddress, listAbiItems, listEvents } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { assertAddress } from "@/lib/pipeline";

export async function GET(_request: Request, context: { params: Promise<{ chainId: string; address: string }> }) {
  try {
    const params = await context.params;
    const chainId = Number(params.chainId);
    if (!isChainId(chainId)) return json({ error: "Unsupported chain" }, 400);
    const address = assertAddress(params.address);
    const contract = await findByAddress(chainId, address);
    if (!contract) return json({ error: "Contract is not on the watchlist. POST /api/v1/watch first." }, 404);
    const [abi, events] = await Promise.all([listAbiItems(contract.id), listEvents(contract.id, 20)]);
    return json({ contract, abiCount: abi.length, recentEvents: events });
  } catch (error) {
    return failure(error);
  }
}
