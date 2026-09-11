// Generated from .env at build time — public addresses only, never keys.
export const CONFIG = {
  creditcoinRpc: 'https://rpc.cc3-testnet.creditcoin.network',
  sepoliaRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  coverAddress: '0xEAb555A0875AA7723c2dc7f8f4c5dcaB55d075AD',
  ascAddress: '0x8A5E70513C8b627264fc1947f229D325eE21Ecce',
  aggregator: '0x719E22E3D4b690E5d96cCb40619180B5427F14AE',
  answerUpdatedTopic: '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f',
  chainInfoPrecompile: '0x0000000000000000000000000000000000000fD3',
  blockProverPrecompile: '0x0000000000000000000000000000000000000FD2',
  sepoliaChainKey: 1,
  // Contracts deployed here. Querying from block 0 times out on a public RPC.
  deployBlock: 5454395,
  explorers: {
    creditcoin: 'https://creditcoin-testnet.blockscout.com',
    sepolia: 'https://sepolia.etherscan.io',
    attestcoinDashboard: 'https://dashboard.cc3-testnet.creditcoin.network',
  },
} as const;
