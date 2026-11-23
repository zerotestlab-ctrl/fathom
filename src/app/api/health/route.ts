import { initDb } from "@/lib/db";
import { json, failure } from "@/lib/http";

export async function GET() {
  try {
    await initDb();
    return json({ ok: true, service: "fathom" });
  } catch (error) {
    return failure(error);
  }
}
