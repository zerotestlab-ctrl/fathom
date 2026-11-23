export const CHAINS = {
  1: {
    id: 1,
    key: "mainnet",
    name: "Ethereum",
    explorer: "https://etherscan.io",
    rpcEnv: "ETH_RPC_URL",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
  },
  42161: {
    id: 42161,
    key: "arbitrum",
    name: "Arbitrum One",
    explorer: "https://arbiscan.io",
    rpcEnv: "ARBITRUM_RPC_URL",
    defaultRpc: "https://arbitrum-one-rpc.publicnode.com",
  },
  8453: {
    id: 8453,
    key: "base",
    name: "Base",
    explorer: "https://basescan.org",
    rpcEnv: "BASE_RPC_URL",
    defaultRpc: "https://base-rpc.publicnode.com",
  },
} as const;

export type ChainId = keyof typeof CHAINS;

export function isChainId(value: number): value is ChainId {
  return value in CHAINS;
}

export function rpcUrlFor(chainId: ChainId): string {
  const configured = process.env[CHAINS[chainId].rpcEnv];
  return configured && configured.trim() ? configured.trim() : CHAINS[chainId].defaultRpc;
}

export function explorerAddress(chainId: number, address: string): string {
  const chain = CHAINS[chainId as ChainId];
  return `${chain?.explorer ?? "https://etherscan.io"}/address/${address}`;
}

export function explorerTx(chainId: number, hash: string): string {
  const chain = CHAINS[chainId as ChainId];
  return `${chain?.explorer ?? "https://etherscan.io"}/tx/${hash}`;
}
