import { toEventSelector, toFunctionSelector } from "viem";
import type { AbiParam } from "@/lib/abi/types";

export function paramType(param: AbiParam): string {
  if (param.type.startsWith("tuple")) {
    const suffix = param.type.slice("tuple".length);
    const inner = (param.components ?? []).map(paramType).join(",");
    return `(${inner})${suffix}`;
  }
  return param.type;
}

export function canonicalSignature(name: string, inputs: AbiParam[] = []): string {
  return `${name}(${inputs.map(paramType).join(",")})`;
}

export function selectorFor(kind: "function" | "error" | "event", signature: string): string {
  try {
    if (kind === "event") return toEventSelector(signature).toLowerCase();
    return toFunctionSelector(signature).toLowerCase();
  } catch {
    return "";
  }
}

export function splitTopLevel(input: string): string[] {
  if (!input.trim()) return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

export function parseSignature(signature: string): { name: string; inputs: AbiParam[] } | null {
  const match = signature.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)\s*$/);
  if (!match) return null;
  const name = match[1];
  const types = splitTopLevel(match[2]);
  const inputs = types.map((type, index) => ({ name: `arg${index}`, type, indexed: false }));
  if (inputs.some((input) => !/^[A-Za-z0-9_\[\](),]+$/.test(input.type))) return null;
  return { name, inputs };
}
