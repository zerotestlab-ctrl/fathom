export const EXAMPLES = [
  {
    id: "weth",
    label: "WETH",
    detail: "Verified",
    chainId: 1,
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    blurb: "Canonical Wrapped Ether on Ethereum. Sourcify has the ABI, and recent blocks are full of deposits and transfers.",
  },
  {
    id: "unverified",
    label: "Unverified",
    detail: "No source",
    chainId: 1,
    address: "0x43f3c2464359f30025fa0374a0f080a7e24aafa8",
    blurb: "Active mainnet contract with no Sourcify match. Swap and Bribe events are recovered from log topics; heimdall rebuilds the functions.",
  },
  {
    id: "aave",
    label: "Aave Pool",
    detail: "EIP-1967",
    chainId: 1,
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    blurb: "Aave V3 Pool proxy. Fathom reads the EIP-1967 implementation slot, then indexes logs emitted by the proxy.",
  },
  {
    id: "arb-usdc",
    label: "USDC",
    detail: "Arbitrum",
    chainId: 42161,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    blurb: "Native USDC on Arbitrum One. Same watch flow, different chain.",
  },
] as const;
