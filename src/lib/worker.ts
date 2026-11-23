import { claimQueued, listReady, resumeInterrupted } from "@/lib/db";
import { seedDemoContracts } from "@/lib/demo";
import { env } from "@/lib/env";
import { runWatch, tailContract } from "@/lib/pipeline";

const globalWorker = globalThis as unknown as { __fathomWorker?: boolean };

async function loop() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  try {
    await resumeInterrupted();
  } catch (error) {
    console.error("[fathom] database is not ready", error instanceof Error ? error.message : error);
  }
  let lastTail = 0;
  let seeded = false;
  for (;;) {
    try {
      if (!seeded) {
        await seedDemoContracts();
        seeded = true;
      }
      const job = await claimQueued();
      if (job) {
        console.log(`[fathom] watching ${job.chainId}:${job.address}`);
        await runWatch(job.id);
        continue;
      }
      if (Date.now() - lastTail > 15_000) {
        lastTail = Date.now();
        const tailCap = env().maxLogs * 4;
        for (const contract of await listReady()) {
          if (contract.logsIndexed >= tailCap) continue;
          try {
            await tailContract(contract);
          } catch (error) {
            console.error("[fathom] tail", contract.address, error instanceof Error ? error.message : error);
          }
        }
      }
    } catch (error) {
      console.error("[fathom] worker", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

export function startWorker() {
  if (globalWorker.__fathomWorker) return;
  globalWorker.__fathomWorker = true;
  void loop();
}
