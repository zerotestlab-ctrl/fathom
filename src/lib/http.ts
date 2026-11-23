export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

export function failure(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Request failed";
  const database = /ECONNREFUSED|connect|password authentication|database/i.test(message);
  return json(
    {
      error: database
        ? "Database is not reachable. Start Postgres with docker compose up, or check DATABASE_URL."
        : message,
    },
    database ? 503 : status,
  );
}
