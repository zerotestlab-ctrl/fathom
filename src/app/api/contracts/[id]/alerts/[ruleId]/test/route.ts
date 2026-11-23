import { deliver } from "@/lib/alerts/deliver";
import { getRule, listFires } from "@/lib/db";
import { failure, json } from "@/lib/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string; ruleId: string }> }) {
  try {
    const { id, ruleId } = await context.params;
    const rule = await getRule(ruleId);
    if (!rule || rule.contractId !== id) return json({ error: "Rule not found" }, 404);
    await deliver(rule, null, false, true);
    return json({ fires: await listFires(id) });
  } catch (error) {
    return failure(error);
  }
}
