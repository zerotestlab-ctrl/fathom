import { describe, expect, it } from "vitest";
import { fromSignature, guessedSelector, mergeAbi, tagStandardAbi } from "@/lib/abi/merge";
import { knownFunctionBySelector } from "@/lib/abi/known";

const transfer = {
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
};

describe("mergeAbi", () => {
  it("keeps a verified function ahead of a guessed selector and a recovered signature", () => {
    const verified = tagStandardAbi([transfer], "verified", "sourcify");
    const guessed = guessedSelector("0xa9059cbb");
    const recovered = fromSignature("function", "transfer(address,uint256)", "recovered", "openchain");
    const merged = mergeAbi([guessed, recovered!, ...verified]);
    const item = merged.find((entry) => entry.selector === "0xa9059cbb");
    expect(item).toMatchObject({
      name: "transfer",
      confidence: "verified",
      source: "sourcify",
      signature: "transfer(address,uint256)",
    });
    expect(merged.filter((entry) => entry.selector === "0xa9059cbb")).toHaveLength(1);
  });

  it("fills selectors the verified ABI does not know", () => {
    const verified = tagStandardAbi([transfer], "verified", "etherscan");
    const owner = knownFunctionBySelector("0x8da5cb5b");
    expect(owner?.name).toBe("owner");
    const merged = mergeAbi([...verified, owner!]);
    expect(merged.map((item) => item.name).sort()).toEqual(["owner", "transfer"]);
    expect(merged.find((item) => item.name === "owner")?.confidence).toBe("recovered");
  });

  it("marks heimdall unresolved selectors as guessed until a signature matches", () => {
    const heimdall = tagStandardAbi(
      [
        { type: "function", name: "Unresolved_095ea7b3", inputs: [], outputs: [] },
        {
          type: "function",
          name: "balanceOf",
          inputs: [{ name: "arg0", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      "recovered",
      "heimdall",
    );
    expect(heimdall.find((item) => item.selector === "0x095ea7b3")?.confidence).toBe("guessed");
    expect(heimdall.find((item) => item.name === "balanceOf")?.confidence).toBe("recovered");
    const approve = fromSignature("function", "approve(address,uint256)", "recovered", "openchain");
    const merged = mergeAbi([...heimdall, approve!]);
    expect(merged.find((item) => item.selector === "0x095ea7b3")).toMatchObject({
      name: "approve",
      confidence: "recovered",
      source: "openchain",
    });
  });

  it("merges events on topic0 and prefers the verified definition", () => {
    const verified = tagStandardAbi(
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
    const recovered = fromSignature("event", "Transfer(address,address,uint256)", "recovered", "openchain");
    const merged = mergeAbi([recovered!, ...verified]);
    const event = merged.find((item) => item.type === "event");
    expect(event?.confidence).toBe("verified");
    expect(event?.inputs[0]?.indexed).toBe(true);
    expect(event?.selector).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  });
});
