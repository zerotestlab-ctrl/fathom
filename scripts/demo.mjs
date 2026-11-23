const base = process.env.FATHOM_URL ?? "http://127.0.0.1:43123";
const address = process.argv[2] ?? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const chainId = Number(process.argv[3] ?? 1);
const blockRange = Number(process.argv[4] ?? 40);

async function api(path, options) {
  const response = await fetch(base + path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${path}`);
  return body;
}

const health = await api("/api/health");
console.log("health", health);

const created = await api("/api/contracts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, chainId, blockRange, refresh: true }),
});
const id = created.contract.id;
console.log("watching", id);

let detail;
for (let attempt = 0; attempt < 60; attempt++) {
  detail = await api(`/api/contracts/${id}`);
  const contract = detail.contract;
  console.log(`${contract.status}  ${contract.statusDetail ?? ""}  logs=${contract.logsIndexed} abi=${detail.abiItems.length}`);
  if (contract.status === "ready" || contract.status === "error") break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

if (detail.contract.status !== "ready") {
  console.error(detail.contract.error);
  process.exit(1);
}

const rule = await api(`/api/contracts/${id}/alerts`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    kind: "large_transfer",
    threshold: "1",
    webhookUrl: `${base}/api/inbox`,
  }),
});
console.log("alerts delivered", rule.fires?.length ?? 0);

const inbox = await api("/api/inbox");
console.log("inbox", inbox.deliveries?.length ?? 0);
const graphql = await api("/api/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `query { decodedEvents(limit: 3, address: "${detail.contract.address}", chainId: ${chainId}) { totalCount items { eventName confidence } } }`,
  }),
});
console.log(JSON.stringify(graphql.data, null, 2));
