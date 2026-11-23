import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeLog } from "@/lib/abi/decode";
import { fromSignature, tagStandardAbi } from "@/lib/abi/merge";
import { matchRule } from "@/lib/alerts/match";
import { assertReadOnlyQuery } from "@/lib/sql-guard";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const ZERO = `0x${"0".repeat(40)}`;

describe("decodeLog", () => {
  it("infers indexed positions for a recovered Transfer signature", () => {
    const event = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
    const topics = encodeEventTopics({
      abi: [event],
      eventName: "Transfer",
      args: { from: FROM, to: TO, value: 1_500n },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [1_500n]);
    const recovered = fromSignature("event", "Transfer(address,address,uint256)", "recovered", "openchain");
    const decoded = decodeLog(
      {
        address: TO,
        topics: [...topics],
        data,
        blockNumber: 1n,
        transactionHash: `0x${"ab".repeat(32)}`,
        logIndex: 4,
      },
      [recovered!],
    );
    expect(decoded.eventName).toBe("Transfer");
    expect(decoded.confidence).toBe("recovered");
    expect(String(decoded.args.arg0).toLowerCase()).toBe(FROM);
    expect(String(decoded.args.arg1).toLowerCase()).toBe(TO);
    expect(decoded.args.arg2).toBe("1500");
  });

  it("uses indexed flags from a verified ABI", () => {
    const verified = tagStandardAbi(
      [
        {
          type: "event",
          name: "Upgraded",
          inputs: [{ name: "implementation", type: "address", indexed: true }],
        },
      ],
      "verified",
      "sourcify",
    );
    const event = parseAbiItem("event Upgraded(address indexed implementation)");
    const topics = encodeEventTopics({
      abi: [event],
      eventName: "Upgraded",
      args: { implementation: TO },
    });
    const decoded = decodeLog(
      {
        address: FROM,
        topics: [...topics],
        data: "0x",
        blockNumber: 2n,
        transactionHash: `0x${"cd".repeat(32)}` as Hex,
        logIndex: 0,
      },
      verified,
    );
    expect(decoded.confidence).toBe("verified");
    expect(String(decoded.args.implementation).toLowerCase()).toBe(TO);
  });
});

describe("matchRule", () => {
  it("matches large transfers, mints, ownership changes, and upgrades", () => {
    expect(
      matchRule(
        { kind: "large_transfer", threshold: "1000" },
        { eventName: "Transfer", args: { from: FROM, to: TO, value: "1000" } },
      ),
    ).toBe(true);
    expect(
      matchRule(
        { kind: "large_transfer", threshold: "1001" },
        { eventName: "Transfer", args: { value: "1000" } },
      ),
    ).toBe(false);
    expect(matchRule({ kind: "mint" }, { eventName: "Transfer", args: { from: ZERO, to: TO, value: "1" } })).toBe(true);
    expect(matchRule({ kind: "mint" }, { eventName: "Minted", args: {} })).toBe(true);
    expect(matchRule({ kind: "mint" }, { eventName: "Transfer", args: { from: FROM, value: "1" } })).toBe(false);
    expect(matchRule({ kind: "ownership_change" }, { eventName: "OwnershipTransferred", args: {} })).toBe(true);
    expect(matchRule({ kind: "proxy_upgrade" }, { eventName: "Upgraded", args: { implementation: TO } })).toBe(true);
    expect(matchRule({ kind: "any_event", eventName: "Deposit" }, { eventName: "Withdrawal", args: {} })).toBe(false);
  });
});

describe("assertReadOnlyQuery", () => {
  it("allows a single select and rejects writes", () => {
    expect(assertReadOnlyQuery("select event_name from decoded_events limit 5;")).toBe(
      "select event_name from decoded_events limit 5",
    );
    expect(() => assertReadOnlyQuery("delete from decoded_events")).toThrow(/SELECT/);
    expect(() => assertReadOnlyQuery("select 1; select 2")).toThrow(/single SELECT/);
    expect(() => assertReadOnlyQuery("select pg_read_file('/etc/passwd')")).toThrow(/will not run/);
  });
});
