import { describe, expect, it } from "vitest";
import { DEMO_CONTRACTS } from "@/lib/examples";

describe("demo contracts", () => {
  it("includes the four contracts a judge should already see", () => {
    const keys = DEMO_CONTRACTS.map((demo) => `${demo.chainId}:${demo.address.toLowerCase()}`);
    expect(keys).toEqual([
      "1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      "1:0x43f3c2464359f30025fa0374a0f080a7e24aafa8",
      "1:0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
      "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    ]);
  });
});
