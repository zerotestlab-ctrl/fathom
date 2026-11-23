const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|copy|create|comment|vacuum|execute|call|do|set|listen|notify|lock|into|load|refresh|merge|discard|reset|reindex|cluster|analyze|begin|commit|rollback|prepare|deallocate|declare|fetch|close|show|dblink|lo_import|lo_export)\b/i;

export function assertReadOnlyQuery(input: string): string {
  const query = input.trim().replace(/;+\s*$/g, "");
  if (!query) throw new Error("Query is empty");
  if (query.length > 4_000) throw new Error("Query is too long");
  if (query.includes(";") || query.includes("--") || query.includes("/*") || query.includes("*/") || query.includes("$$")) {
    throw new Error("Only a single SELECT statement is allowed");
  }
  if (!/^(select|with)\b/i.test(query)) throw new Error("Only SELECT queries are allowed");
  if (FORBIDDEN.test(query) || /\bpg_/i.test(query)) throw new Error("Query contains a statement Fathom will not run");
  return query;
}
