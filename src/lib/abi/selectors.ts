export function stripSolidityMetadata(bytecode: string): string {
  const hex = bytecode.toLowerCase().replace(/^0x/, "");
  if (hex.length < 4 || hex.length % 2 !== 0) return hex;
  const bytesLen = hex.length / 2;
  const metaLen = Number.parseInt(hex.slice(-4), 16);
  if (!Number.isFinite(metaLen) || metaLen <= 0 || metaLen >= bytesLen - 1) return hex;
  const start = hex.length - 4 - metaLen * 2;
  const marker = hex.slice(start, start + 2);
  if (marker !== "a1" && marker !== "a2" && marker !== "a3") return hex;
  return hex.slice(0, start);
}

export function extractSelectors(bytecode: string): string[] {
  const hex = stripSolidityMetadata(bytecode);
  const selectors = new Set<string>();
  for (let i = 0; i < hex.length; ) {
    const opcode = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(opcode)) break;
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const pushBytes = opcode - 0x5f;
      if (opcode === 0x63 && i + 10 <= hex.length) {
        const selector = `0x${hex.slice(i + 2, i + 10)}`;
        const next = hex.slice(i + 10, i + 12);
        if (next === "14" || next === "81") selectors.add(selector);
      }
      i += 2 + pushBytes * 2;
    } else {
      i += 2;
    }
  }
  return [...selectors];
}
