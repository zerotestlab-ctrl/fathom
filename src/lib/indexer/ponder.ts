import type { ChainId } from "@/lib/chains";
import { CHAINS } from "@/lib/chains";
import type { TaggedAbiItem } from "@/lib/abi/types";

export type PonderInput = {
  chainId: ChainId;
  address: string;
  startBlock: number;
  endBlock: number;
  items: TaggedAbiItem[];
};

function contractName(address: string): string {
  return `Watched_${address.toLowerCase().slice(2, 8)}`;
}

function identifier(name: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}

function plainAbi(items: TaggedAbiItem[]) {
  const events = new Set<string>();
  const abi = [];
  for (const item of items) {
    if (item.confidence === "guessed") continue;
    if (!identifier(item.name)) continue;
    if (item.type === "event") {
      if (item.anonymous || !item.signature || events.has(item.name)) continue;
      events.add(item.name);
      abi.push({
        type: "event",
        name: item.name,
        anonymous: false,
        inputs: item.inputs.map((input) => ({
          name: input.name,
          type: input.type,
          indexed: input.indexed === true,
          ...(input.components ? { components: input.components } : {}),
        })),
      });
      continue;
    }
    if (item.type === "function") {
      abi.push({
        type: "function",
        name: item.name,
        stateMutability: item.stateMutability ?? "nonpayable",
        inputs: item.inputs.map((input) => ({
          name: input.name,
          type: input.type,
          ...(input.components ? { components: input.components } : {}),
        })),
        outputs: item.outputs.map((output) => ({
          name: output.name,
          type: output.type,
          ...(output.components ? { components: output.components } : {}),
        })),
      });
    }
  }
  return abi;
}

export function generatePonderProject(input: PonderInput): Record<string, string> {
  const chain = CHAINS[input.chainId];
  const name = contractName(input.address);
  const abi = plainAbi(input.items);
  const events = abi.filter((item) => item.type === "event");
  const confidence = new Map(
    input.items.filter((item) => item.type === "event").map((item) => [item.name, item.confidence]),
  );

  const handlers = events
    .map((event) => {
      const tag = confidence.get(event.name) ?? "recovered";
      const signature = `${event.name}(${event.inputs.map((input) => input.type).join(",")})`;
      return `ponder.on("${name}:${event.name}", async ({ event, context }) => {
  await context.db
    .insert(decodedEvent)
    .values({
      id: \`\${context.chain.id}:\${event.transaction.hash}:\${event.log.logIndex}\`,
      chainId: context.chain.id,
      address: event.log.address,
      eventName: event.name,
      signature: ${JSON.stringify(signature)},
      confidence: ${JSON.stringify(tag)},
      argsJson: JSON.stringify(event.args, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    })
    .onConflictDoNothing();
});`;
    })
    .join("\n\n");

  const config = `import { createConfig } from "ponder";
import { http } from "viem";
import { abi } from "./abis/${name}";

const rpc = process.env.${chain.rpcEnv} ?? ${JSON.stringify(chain.defaultRpc)};

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    ${chain.key}: {
      id: ${chain.id},
      rpc: http(rpc),
      pollingInterval: 12_000,
      ethGetLogsBlockRange: 20,
    },
  },
  contracts: {
    ${name}: {
      abi,
      chain: ${JSON.stringify(chain.key)},
      address: ${JSON.stringify(input.address)},
      startBlock: ${input.startBlock},
      endBlock: ${input.endBlock},
    },
  },
});
`;

  const schema = `import { index, onchainTable } from "ponder";

export const decodedEvent = onchainTable(
  "decoded_event",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    eventName: t.text().notNull(),
    signature: t.text(),
    confidence: t.text().notNull(),
    argsJson: t.text().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
  }),
  (table) => ({
    blockIdx: index().on(table.blockNumber),
    nameIdx: index().on(table.eventName),
  }),
);
`;

  const indexer = `import { ponder } from "ponder:registry";
import { decodedEvent } from "ponder:schema";

${handlers || "// No named events were recovered, so this project has no log handlers yet.\n"}
`;

  const api = `import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";

const app = new Hono();

app.use("/graphql", graphql({ db, schema }));
app.use("/sql/*", client({ db, schema }));

export default app;
`;

  const packageJson = `{
  "name": "fathom-ponder-${name.toLowerCase()}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "ponder dev",
    "start": "ponder start"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "ponder": "0.18.9",
    "viem": "^2.31.0"
  }
}
`;

  const readme = `# Generated Ponder project

Fathom generated this project for \`${input.address}\` on ${chain.name}.

It indexes blocks ${input.startBlock} through ${input.endBlock}. Use a separate Postgres schema so it does not collide with Fathom's own tables:

\`\`\`bash
npm install
DATABASE_URL=postgresql://fathom:fathom@127.0.0.1:5432/fathom DATABASE_SCHEMA=fathom_ponder npm run dev
\`\`\`

GraphQL is served at http://127.0.0.1:42069/graphql and SQL-over-HTTP at http://127.0.0.1:42069/sql.
`;

  return {
    "ponder.config.ts": config,
    "ponder.schema.ts": schema,
    "src/index.ts": indexer,
    "src/api/index.ts": api,
    [`abis/${name}.ts`]: `export const abi = ${JSON.stringify(abi, null, 2)} as const;\n`,
    "package.json": packageJson,
    "README.md": readme,
  };
}
