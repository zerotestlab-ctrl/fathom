import { insertInbox, listInbox } from "@/lib/db";
import { failure, json } from "@/lib/http";

export async function GET() {
  try {
    return json({ deliveries: await listInbox() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (key === "authorization" || key === "cookie") return;
      headers[key] = value;
    });
    await insertInbox(body, headers);
    return json({ ok: true }, 202);
  } catch (error) {
    return failure(error);
  }
}
