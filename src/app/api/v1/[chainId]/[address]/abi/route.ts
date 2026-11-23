import { isChainId } from "@/lib/chains";
import { findByAddress, listAbiItems } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { assertAddress } from "@/lib/pipeline";

export async function GET(_request: Request, context: { params: Promise<{ chainId: string; address: string }> }) {
  try {
    const params = await context.params;
    const chainId = Number(params.chainId);
    if (!isChainId(chainId)) return json({ error: "Unsupported chain" }, 400);
    const address = assertAddress(params.address);
    const contract = await findByAddress(chainId, address);
    if (!contract) return json({ error: "Contract is not on the watchlist." }, 404);
    return json({ address, chainId, abiSource: contract.abiSource, items: await listAbiItems(contract.id) });
  } catch (error) {
    return failure(error);
  }
}
