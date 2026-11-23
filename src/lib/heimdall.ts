import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "@/lib/env";

export type HeimdallResult = {
  status: "done" | "failed" | "unavailable" | "timeout";
  abi: unknown;
  source: string | null;
  message: string;
  durationMs: number;
};

function heimdallBin(): string | null {
  const candidates = [process.env.HEIMDALL_BIN, path.resolve("bin/heimdall"), "heimdall"].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    if (candidate === "heimdall" || existsSync(candidate)) return candidate;
  }
  return null;
}

async function findFile(dir: string, predicate: (name: string) => boolean): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && predicate(entry.name)) return full;
    if (entry.isDirectory()) {
      const nested = await findFile(full, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

export async function decompileBytecode(bytecode: string): Promise<HeimdallResult> {
  const started = Date.now();
  const bin = heimdallBin();
  if (!bin) {
    return {
      status: "unavailable",
      abi: [],
      source: null,
      message: "heimdall binary not found. Set HEIMDALL_BIN or install it at bin/heimdall.",
      durationMs: 0,
    };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "fathom-heimdall-"));
  const target = path.join(dir, "bytecode.hex");
  await writeFile(target, bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`);
  let timedOut = false;
  let failed = false;
  try {
    await execFile(
      bin,
      ["decompile", target, "-d", "--include-sol", "--color", "never", "--timeout", "3000", "-o", dir],
      { timeout: env().heimdallTimeoutMs, maxBuffer: 2_000_000 },
    );
  } catch (error) {
    failed = true;
    timedOut = error instanceof Error && "killed" in error && Boolean((error as { killed?: boolean }).killed);
  }
  const abi = (await readAbi(dir)) ?? [];
  const source = await readSource(dir);
  await rm(dir, { recursive: true, force: true });
  const count = Array.isArray(abi) ? abi.length : 0;
  if (failed && count === 0) {
    return {
      status: timedOut ? "timeout" : "failed",
      abi: [],
      source,
      message: timedOut ? "Heimdall timed out before writing an ABI." : "Heimdall failed before writing an ABI.",
      durationMs: Date.now() - started,
    };
  }
  return {
    status: timedOut ? "timeout" : "done",
    abi,
    source,
    message: timedOut
      ? `Heimdall hit the time limit after writing ${count} ABI entries.`
      : `Heimdall returned ${count} ABI entries.`,
    durationMs: Date.now() - started,
  };
}

async function readAbi(dir: string): Promise<unknown | null> {
  const file = await findFile(dir, (name) => name === "abi.json" || name.endsWith(".abi.json"));
  if (!file) return null;
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function readSource(dir: string): Promise<string | null> {
  const file = await findFile(dir, (name) => name.endsWith(".sol"));
  if (!file) return null;
  const text = await readFile(/* turbopackIgnore: true */ file, "utf8");
  return text.slice(0, 120_000);
}
