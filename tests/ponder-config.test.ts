import { describe, expect, it } from "vitest";
import { fromSignature, tagStandardAbi } from "@/lib/abi/merge";
import { generatePonderProject } from "@/lib/indexer/ponder";

describe("generatePonderProject", () => {
  it("writes a bounded Ponder config, schema, handlers, and API", () => {
    const transfer = tagStandardAbi(
      [
        {
          type: "event",
          name: "Transfer",
          inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "value", type: "uint256", indexed: false },
          ],
        },
      ],
      "verified",
      "sourcify",
    );
    const unknown = fromSignature("event", "Weird(uint256)", "guessed", "log-topic");
    const files = generatePonderProject({
      chainId: 1,
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      startBlock: 21_000_000,
      endBlock: 21_000_200,
      items: [...transfer, unknown!],
    });

    expect(files["ponder.config.ts"]).toContain('address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"');
    expect(files["ponder.config.ts"]).toContain("startBlock: 21000000");
    expect(files["ponder.config.ts"]).toContain("endBlock: 21000200");
    expect(files["ponder.config.ts"]).toContain('chain: "mainnet"');
    expect(files["ponder.config.ts"]).toContain("ETH_RPC_URL");
    expect(files["ponder.schema.ts"]).toContain("decodedEvent");
    expect(files["ponder.schema.ts"]).toContain('onchainTable');
    expect(files["src/index.ts"]).toContain('ponder.on("Watched_c02aaa:Transfer"');
    expect(files["src/index.ts"]).not.toContain("Weird");
    expect(files["src/index.ts"]).toContain('confidence: "verified"');
    expect(files["src/api/index.ts"]).toContain('graphql({ db, schema })');
    expect(files["src/api/index.ts"]).toContain('client({ db, schema })');
    expect(files["abis/Watched_c02aaa.ts"]).toContain('"name": "Transfer"');
    expect(files["package.json"]).toContain('"ponder": "0.18.9"');
  });

  it("still emits a valid project when no event names were recovered", () => {
    const files = generatePonderProject({
      chainId: 42161,
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      startBlock: 100,
      endBlock: 200,
      items: [],
    });
    expect(files["ponder.config.ts"]).toContain('chain: "arbitrum"');
    expect(files["src/index.ts"]).toContain("No named events");
    expect(files["src/api/index.ts"]).toContain("/sql/*");
  });
});
