/**
 * Minimal stdio MCP server for agents. Requires the Fathom app to be running.
 * Tools call the REST API. No extra dependencies.
 *
 *   FATHOM_URL=http://127.0.0.1:43123 node mcp/server.mjs
 */
const base = process.env.FATHOM_URL ?? "http://127.0.0.1:43123";

const tools = [
  {
    name: "get_contract",
    description: "Fetch a watched contract: proxy resolution, ABI source, and recent decoded events.",
    inputSchema: {
      type: "object",
      properties: { chainId: { type: "number" }, address: { type: "string" } },
      required: ["chainId", "address"],
    },
  },
  {
    name: "get_abi",
    description: "Return ABI items with confidence tags (verified, recovered, guessed).",
    inputSchema: {
      type: "object",
      properties: { chainId: { type: "number" }, address: { type: "string" } },
      required: ["chainId", "address"],
    },
  },
  {
    name: "list_events",
    description: "List decoded events for a watched contract.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number" },
        address: { type: "string" },
        limit: { type: "number" },
        event: { type: "string" },
      },
      required: ["chainId", "address"],
    },
  },
];

async function callTool(name, args) {
  const chainId = args.chainId;
  const address = args.address;
  let path = `/api/v1/${chainId}/${address}`;
  if (name === "get_abi") path += "/abi";
  if (name === "list_events") {
    const params = new URLSearchParams();
    if (args.limit) params.set("limit", String(args.limit));
    if (args.event) params.set("event", args.event);
    path += `/events?${params.toString()}`;
  }
  const response = await fetch(base + path);
  const text = await response.text();
  return { content: [{ type: "text", text }], isError: !response.ok };
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const raw = buffer.slice(start, start + length).toString("utf8");
    buffer = buffer.slice(start + length);
    void handle(JSON.parse(raw));
  }
});

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fathom", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments ?? {});
      send({ jsonrpc: "2.0", id, result });
    } catch (error) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : "tool failed" } });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
}
