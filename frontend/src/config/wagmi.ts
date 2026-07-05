'use client';

import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { hardhat, sepolia } from 'wagmi/chains';
import type { Chain } from 'viem';
import { CHAIN_IDS, DEFAULT_CHAIN_ID, RPC_URLS } from '@/config/contracts';

const localhostChain: Chain = {
  ...hardhat, // id 31337
  name: 'Localhost (Hardhat)',
  rpcUrls: {
    default: { http: [RPC_URLS[CHAIN_IDS.hardhat]] },
  },
};

const sepoliaChain: Chain = {
  ...sepolia,
  rpcUrls: {
    default: { http: [RPC_URLS[CHAIN_IDS.sepolia]] },
  },
};

const chains =
  DEFAULT_CHAIN_ID === CHAIN_IDS.sepolia
    ? ([sepoliaChain, localhostChain] as const)
    : ([localhostChain, sepoliaChain] as const);

// WalletConnect-based wallets are only offered when a real project id is
// configured; the injected flow (MetaMask extension etc.) needs nothing.
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallets',
      wallets: wcProjectId
        ? [injectedWallet, metaMaskWallet, walletConnectWallet]
        : [injectedWallet],
    },
  ],
  {
    appName: 'YieldVault',
    projectId: wcProjectId || 'YIELDVAULT_PLACEHOLDER',
  }
);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [CHAIN_IDS.hardhat]: http(RPC_URLS[CHAIN_IDS.hardhat]),
    [CHAIN_IDS.sepolia]: http(RPC_URLS[CHAIN_IDS.sepolia]),
  },
  ssr: true,
});
