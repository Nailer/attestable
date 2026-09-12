// Wallet connection and write paths.
//
// Reads go through a plain RPC provider (see chain.ts). Everything that costs
// money or changes state goes through the user's own wallet, signed by them.
// This file never holds a key and never sends anything the user did not approve.
import { ethers } from 'ethers';
import { CONFIG } from './config';
import coverAbi from './cover.abi.json';

export const CREDITCOIN_CHAIN_ID = 102031;
const CHAIN_ID_HEX = '0x18e8f'; // 102031

export interface WalletState {
  address: string;
  chainId: number;
  onCorrectChain: boolean;
}

function eth(): any {
  const e = (window as any).ethereum;
  if (!e) throw new Error('No wallet found. Install MetaMask, then reload this page.');
  return e;
}

export function hasWallet(): boolean {
  return typeof (window as any).ethereum !== 'undefined';
}

export async function connect(): Promise<WalletState> {
  const provider = eth();
  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
  const chainIdHex: string = await provider.request({ method: 'eth_chainId' });
  const chainId = parseInt(chainIdHex, 16);
  return { address: accounts[0], chainId, onCorrectChain: chainId === CREDITCOIN_CHAIN_ID };
}

export async function currentState(): Promise<WalletState | null> {
  if (!hasWallet()) return null;
  const provider = eth();
  const accounts: string[] = await provider.request({ method: 'eth_accounts' });
  if (accounts.length === 0) return null;
  const chainIdHex: string = await provider.request({ method: 'eth_chainId' });
  const chainId = parseInt(chainIdHex, 16);
  return { address: accounts[0], chainId, onCorrectChain: chainId === CREDITCOIN_CHAIN_ID };
}

/** Switch to Creditcoin, adding the network to the wallet if it isn't known yet. */
export async function switchToCreditcoin(): Promise<void> {
  const provider = eth();
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e: any) {
    // 4902 = chain unknown to the wallet
    if (e?.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: 'Creditcoin CC3 Testnet',
            nativeCurrency: { name: 'Test CTC', symbol: 'tCTC', decimals: 18 },
            rpcUrls: [CONFIG.creditcoinRpc],
            blockExplorerUrls: [CONFIG.explorers.creditcoin],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

async function signer(): Promise<ethers.Signer> {
  const browserProvider = new ethers.BrowserProvider(eth());
  return browserProvider.getSigner();
}

async function writeContract(): Promise<ethers.Contract> {
  return new ethers.Contract(CONFIG.coverAddress, coverAbi, await signer());
}

export interface NewCoverTerms {
  windowStart: number;
  windowEnd: number;
  windowStartBlock: number;
  windowEndBlock: number;
  toleranceSecs: number;
  collateralCtc: string;
  premiumCtc: string;
}

/** Underwriter: open a cover and post collateral. */
export async function createCover(t: NewCoverTerms): Promise<{ hash: string; coverId: number }> {
  const c = await writeContract();
  const policy = {
    chainKey: CONFIG.sepoliaChainKey,
    sourceContract: CONFIG.aggregator,
    eventSignature: CONFIG.answerUpdatedTopic,
    windowStart: t.windowStart,
    windowEnd: t.windowEnd,
    windowStartBlock: t.windowStartBlock,
    windowEndBlock: t.windowEndBlock,
    toleranceSecs: t.toleranceSecs,
  };
  const tx = await c.createCover(policy, ethers.parseEther(t.premiumCtc), {
    value: ethers.parseEther(t.collateralCtc),
  });
  const rc = await tx.wait();
  let coverId = 0;
  for (const log of rc.logs) {
    try {
      const parsed = c.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'CoverCreated') coverId = Number(parsed.args[0]);
    } catch {
      /* not ours */
    }
  }
  return { hash: tx.hash, coverId };
}

/** Buyer: take a cover by paying exactly the stated premium. */
export async function buyCover(coverId: number, premiumWei: bigint): Promise<string> {
  const c = await writeContract();
  const tx = await c.buyCover(coverId, { value: premiumWei });
  await tx.wait();
  return tx.hash;
}

/** Underwriter: reclaim collateral from a cover nobody bought. */
export async function cancelCover(coverId: number): Promise<string> {
  const c = await writeContract();
  const tx = await c.cancelCover(coverId);
  await tx.wait();
  return tx.hash;
}

/**
 * Anyone: trigger settlement.
 *
 * Permissionless on purpose — it can only pay out according to evidence the
 * contract already verified, so there is nothing to gain by calling it early or
 * often, and no party can hold the other's funds hostage by refusing to act.
 */
export async function settle(coverId: number): Promise<string> {
  const c = await writeContract();
  const tx = await c.settle(coverId, { gasLimit: 500_000 });
  await tx.wait();
  return tx.hash;
}

/** Turn a contract revert into something a human can act on. */
export function explainError(e: any): string {
  const raw: string = e?.shortMessage ?? e?.message ?? String(e);
  if (e?.code === 'ACTION_REJECTED' || /user rejected/i.test(raw)) return 'You rejected the transaction in your wallet.';
  if (/WindowNotClosed/.test(raw)) return 'The coverage window has not ended yet. Settlement is only possible after it closes.';
  if (/WindowNotAttested/.test(raw)) return 'Attestcoin has not yet attested the end of this window. Evidence could not have been supplied yet, so settling now would be unsafe. Try again shortly.';
  if (/WrongStatus/.test(raw)) return 'This cover is not in a state that allows that action.';
  if (/PremiumMismatch/.test(raw)) return 'The premium must be paid exactly as stated.';
  if (/NotUnderwriter/.test(raw)) return 'Only the underwriter who created this cover can cancel it.';
  if (/insufficient funds/i.test(raw)) return 'Not enough tCTC in your wallet to cover this amount plus gas.';
  return raw;
}
