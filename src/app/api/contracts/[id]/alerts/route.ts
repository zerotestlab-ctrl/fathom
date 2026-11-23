import { deliverRuleMatches, isAlertKind } from "@/lib/alerts/deliver";
import { createRule, getContract, listFires, listRules } from "@/lib/db";
import { failure, json } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!(await getContract(id))) return json({ error: "Watch not found" }, 404);
    return json({ rules: await listRules(id), fires: await listFires(id) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!(await getContract(id))) return json({ error: "Watch not found" }, 404);
    const body = (await request.json()) as {
      kind?: string;
      threshold?: string;
      eventName?: string;
      webhookUrl?: string;
      telegramChatId?: string;
    };
    if (!body.kind || !isAlertKind(body.kind)) throw new Error("Unknown alert rule.");
    const webhookUrl = body.webhookUrl?.trim() || null;
    const telegramChatId = body.telegramChatId?.trim() || null;
    if (!webhookUrl && !telegramChatId) throw new Error("Add a webhook URL or a Telegram chat id.");
    const rule = await createRule({
      contractId: id,
      kind: body.kind,
      threshold: body.threshold?.trim() || null,
      eventName: body.eventName?.trim() || null,
      webhookUrl,
      telegramChatId,
    });
    await deliverRuleMatches(id, { limit: 3, backfill: true });
    return json({ rule, fires: await listFires(id) }, 201);
  } catch (error) {
    return failure(error);
  }
}
