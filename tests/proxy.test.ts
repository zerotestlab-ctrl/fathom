import { describe, expect, it } from "vitest";
import {
  addressFromWord,
  detectClone,
  EIP1967_IMPLEMENTATION_SLOT,
  interpretSlots,
  OZ_LEGACY_IMPLEMENTATION_SLOT,
} from "@/lib/proxy/detect";
import { resolveProxy, type ChainReader } from "@/lib/proxy/resolve";
import type { Hex } from "viem";

const IMPL = "0x1111111111111111111111111111111111111111";
const LOGIC = "0x600160005260206000f3" as Hex;

describe("proxy detection", () => {
  it("reads an EIP-1167 clone and a Solady clone", () => {
    const eip = `0x363d3d373d3d3d363d73${IMPL.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
    expect(detectClone(eip)).toMatchObject({ kind: "eip1167", implementation: IMPL });
    const solady = `0x3d3d3d3d363d3d37363d73${IMPL.slice(2).toLowerCase()}5af43d3d93803e602a57fd5bf3`;
    expect(detectClone(solady)).toMatchObject({ kind: "eip1167-solady", implementation: IMPL });
    expect(detectClone(LOGIC)).toBeNull();
  });

  it("uses the standard EIP-1967 slot and ignores an empty word", () => {
    expect(EIP1967_IMPLEMENTATION_SLOT).toBe("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
    expect(OZ_LEGACY_IMPLEMENTATION_SLOT).toBe("0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3");
    expect(addressFromWord(`0x${"0".repeat(24)}${IMPL.slice(2)}`)).toBe(IMPL);
    expect(addressFromWord(`0x${"0".repeat(64)}`)).toBeNull();
  });

  it("interprets storage slots without treating a normal contract's slot 0 as a proxy", () => {
    const word = `0x${"0".repeat(24)}${IMPL.slice(2).toLowerCase()}`;
    expect(
      interpretSlots({
        bytecode: LOGIC,
        implementationSlot: word,
        adminSlot: "0x",
        beaconSlot: "0x",
        legacySlot: "0x",
        slot0: "0x",
      })?.kind,
    ).toBe("eip1967");
    expect(
      interpretSlots({
        bytecode: "0x363d3d373d3d3d363d73",
        implementationSlot: "0x",
        adminSlot: "0x",
        beaconSlot: word,
        legacySlot: "0x",
        slot0: "0x",
      })?.kind,
    ).toBe("eip1967-beacon");
    expect(
      interpretSlots({
        bytecode: "0x6080604052",
        implementationSlot: "0x",
        adminSlot: "0x",
        beaconSlot: "0x",
        legacySlot: "0x",
        slot0: word,
      })?.kind,
    ).toBe("slot0-implementation");
    expect(
      interpretSlots({
        bytecode: `0x${"60".repeat(400)}`,
        implementationSlot: "0x",
        adminSlot: "0x",
        beaconSlot: "0x",
        legacySlot: "0x",
        slot0: word,
      }),
    ).toBeNull();
  });
});

describe("resolveProxy", () => {
  it("follows a clone to the implementation bytecode", async () => {
    const proxy = `0x363d3d373d3d3d363d73${IMPL.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as Hex;
    const reader: ChainReader = {
      async getCode(address) {
        return address.toLowerCase() === IMPL.toLowerCase() ? LOGIC : proxy;
      },
      async getStorageAt() {
        return "0x";
      },
      async call() {
        return "0x";
      },
    };
    const resolved = await resolveProxy(reader, "0x2222222222222222222222222222222222222222", proxy);
    expect(resolved.isProxy).toBe(true);
    expect(resolved.kind).toBe("eip1167");
    expect(resolved.implementation).toBe(IMPL);
    expect(resolved.logicCode).toBe(LOGIC);
  });

  it("calls implementation() on an EIP-1967 beacon", async () => {
    const beacon = "0x3333333333333333333333333333333333333333";
    const beaconWord = `0x${"0".repeat(24)}${beacon.slice(2).toLowerCase()}` as Hex;
    const implWord = `0x${"0".repeat(24)}${IMPL.slice(2).toLowerCase()}` as Hex;
    const reader: ChainReader = {
      async getCode(address) {
        return address.toLowerCase() === IMPL.toLowerCase() ? LOGIC : "0x6080604052";
      },
      async getStorageAt(_address, slot) {
        return slot === "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" ? beaconWord : "0x";
      },
      async call() {
        return implWord;
      },
    };
    const resolved = await resolveProxy(reader, "0x4444444444444444444444444444444444444444", "0x6080604052");
    expect(resolved.kind).toBe("eip1967-beacon");
    expect(resolved.implementation).toBe(IMPL);
    expect(resolved.beacon).toBe(beacon);
  });
});
