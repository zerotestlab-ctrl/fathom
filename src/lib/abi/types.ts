export type Confidence = "verified" | "recovered" | "guessed";

export type AbiKind = "function" | "event" | "error" | "constructor" | "fallback" | "receive";

export type AbiParam = {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiParam[];
};

export type TaggedAbiItem = {
  type: AbiKind;
  name: string;
  signature: string;
  selector: string;
  inputs: AbiParam[];
  outputs: AbiParam[];
  stateMutability?: string;
  anonymous?: boolean;
  confidence: Confidence;
  source: string;
};

export function confidenceRank(confidence: Confidence): number {
  if (confidence === "verified") return 3;
  if (confidence === "recovered") return 2;
  return 1;
}
