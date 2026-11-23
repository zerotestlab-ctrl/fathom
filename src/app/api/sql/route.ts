import { runReadOnlyQuery } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { jsonSafe } from "@/lib/format";
import { assertReadOnlyQuery } from "@/lib/sql-guard";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: string };
    const query = assertReadOnlyQuery(String(body.query ?? ""));
    const rows = await runReadOnlyQuery(query);
    return json({ rows: jsonSafe(rows) });
  } catch (error) {
    return failure(error);
  }
}
