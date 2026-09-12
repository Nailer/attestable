// Generated from .env at build time — public addresses only, never keys.
export const CONFIG = {
  creditcoinRpc: 'https://rpc.cc3-testnet.creditcoin.network',
  proofBuilderUrl: 'https://prover.cc3-testnet.creditcoin.network',
  sepoliaRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  coverAddress: '0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89',
  ascAddress: '0xDd1618a762cE8b4C9Bc849Bb6FF260519B221775',
  aggregator: '0x719E22E3D4b690E5d96cCb40619180B5427F14AE',
  answerUpdatedTopic: '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f',
  chainInfoPrecompile: '0x0000000000000000000000000000000000000fD3',
  blockProverPrecompile: '0x0000000000000000000000000000000000000FD2',
  sepoliaChainKey: 1,
  // Contracts deployed here. Querying from block 0 times out on a public RPC.
  deployBlock: 5474838,
  explorers: {
    creditcoin: 'https://creditcoin-testnet.blockscout.com',
    sepolia: 'https://sepolia.etherscan.io',
    attestcoinDashboard: 'https://dashboard.cc3-testnet.creditcoin.network',
  },
} as const;
