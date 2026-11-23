import { contractDetail } from "@/lib/db";
import { failure, json } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await contractDetail(id);
    if (!detail) return json({ error: "Watch not found" }, 404);
    return json(detail);
  } catch (error) {
    return failure(error);
  }
}
