import { getAddress } from "viem";
import { enqueueWatch } from "@/lib/db";
import { env } from "@/lib/env";
import { DEMO_CONTRACTS } from "@/lib/examples";

export function demoSeedEnabled(): boolean {
  return process.env.SEED_DEMO !== "false";
}

export async function seedDemoContracts(): Promise<void> {
  if (!demoSeedEnabled()) return;
  const blockRange = env().blockRange;
  for (const demo of DEMO_CONTRACTS) {
    const contract = await enqueueWatch({
      chainId: demo.chainId,
      address: getAddress(demo.address),
      blockRange,
    });
    console.log(`[fathom] demo ${demo.label} ${contract.status} ${contract.address}`);
  }
}
