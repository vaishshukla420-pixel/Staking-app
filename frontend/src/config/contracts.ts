import type { Address } from 'viem';

/**
 * Per-chain contract address maps for the YieldVault protocol.
 *
 * NOTE: all addresses below are ZERO-ADDRESS PLACEHOLDERS. They are filled in
 * after the contracts are deployed (paste them here, or set the matching
 * NEXT_PUBLIC_* env vars — env vars take precedence, see `envAddr` below).
 *
 * The UI treats a zero address as "not deployed yet" and renders a graceful
 * placeholder state instead of firing RPC calls at it.
 */

export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address;

export const CHAIN_IDS = {
  hardhat: 31337,
  sepolia: 11155111,
} as const;

export type SupportedChainId =
  (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const SUPPORTED_CHAIN_IDS: SupportedChainId[] = [
  CHAIN_IDS.hardhat,
  CHAIN_IDS.sepolia,
];

/** Vault keys for the three ERC-4626 vaults on the EVM side. */
export type EvmVaultKey = 'USDC' | 'WETH' | 'WSOL';

export interface VaultAddresses {
  /** The ERC-4626 YieldVault contract. */
  vault: Address;
  /** The underlying ERC-20 (USDC / WETH / wSOL). */
  asset: Address;
}

export interface ChainContracts {
  vaults: Record<EvmVaultKey, VaultAddresses>;
  /** Native-ETH gateway in front of the WETH vault. */
  ethGateway: Address;
}

/**
 * Use an env-provided address when valid, otherwise fall back to the
 * hardcoded placeholder. Env vars must be referenced statically
 * (process.env.NEXT_PUBLIC_...) so Next.js can inline them client-side.
 */
function envAddr(value: string | undefined, fallback: Address): Address {
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as Address;
  return fallback;
}

export const CONTRACTS: Record<SupportedChainId, ChainContracts> = {
  [CHAIN_IDS.hardhat]: {
    vaults: {
      USDC: {
        vault: envAddr(process.env.NEXT_PUBLIC_USDC_VAULT_31337, ZERO_ADDRESS),
        asset: envAddr(process.env.NEXT_PUBLIC_USDC_TOKEN_31337, ZERO_ADDRESS),
      },
      WETH: {
        vault: envAddr(process.env.NEXT_PUBLIC_WETH_VAULT_31337, ZERO_ADDRESS),
        asset: envAddr(process.env.NEXT_PUBLIC_WETH_TOKEN_31337, ZERO_ADDRESS),
      },
      WSOL: {
        vault: envAddr(process.env.NEXT_PUBLIC_WSOL_VAULT_31337, ZERO_ADDRESS),
        asset: envAddr(process.env.NEXT_PUBLIC_WSOL_TOKEN_31337, ZERO_ADDRESS),
      },
    },
    ethGateway: envAddr(
      process.env.NEXT_PUBLIC_ETH_GATEWAY_31337,
      ZERO_ADDRESS
    ),
  },
  [CHAIN_IDS.sepolia]: {
    vaults: {
      USDC: {
        vault: envAddr(
          process.env.NEXT_PUBLIC_USDC_VAULT_11155111,
          ZERO_ADDRESS
        ),
        asset: envAddr(
          process.env.NEXT_PUBLIC_USDC_TOKEN_11155111,
          ZERO_ADDRESS
        ),
      },
      WETH: {
        vault: envAddr(
          process.env.NEXT_PUBLIC_WETH_VAULT_11155111,
          ZERO_ADDRESS
        ),
        asset: envAddr(
          process.env.NEXT_PUBLIC_WETH_TOKEN_11155111,
          ZERO_ADDRESS
        ),
      },
      WSOL: {
        vault: envAddr(
          process.env.NEXT_PUBLIC_WSOL_VAULT_11155111,
          ZERO_ADDRESS
        ),
        asset: envAddr(
          process.env.NEXT_PUBLIC_WSOL_TOKEN_11155111,
          ZERO_ADDRESS
        ),
      },
    },
    ethGateway: envAddr(
      process.env.NEXT_PUBLIC_ETH_GATEWAY_11155111,
      ZERO_ADDRESS
    ),
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isSupportedChainId(
  chainId: number | undefined
): chainId is SupportedChainId {
  return (
    chainId !== undefined &&
    SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)
  );
}

export function getContracts(
  chainId: number | undefined
): ChainContracts | undefined {
  if (!isSupportedChainId(chainId)) return undefined;
  return CONTRACTS[chainId];
}

/** Zero address == "not deployed yet". */
export function isDeployed(address: Address | undefined): address is Address {
  return !!address && address !== ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// Chain / RPC configuration (NEXT_PUBLIC_* env with sensible defaults)
// ---------------------------------------------------------------------------

export const RPC_URLS: Record<SupportedChainId, string> = {
  [CHAIN_IDS.hardhat]:
    process.env.NEXT_PUBLIC_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545',
  [CHAIN_IDS.sepolia]:
    process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA ?? 'https://rpc.sepolia.org',
};

export const DEFAULT_CHAIN_ID: SupportedChainId = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? '31337');
  return isSupportedChainId(raw) ? raw : CHAIN_IDS.hardhat;
})();

/** Display metadata for the three EVM vault assets. */
export interface EvmAssetMeta {
  key: EvmVaultKey;
  /** Symbol shown in the UI (the ETH card fronts the WETH vault). */
  displaySymbol: string;
  name: string;
  decimals: number;
  /** True for the ETH card: deposits/withdrawals go through EthGateway. */
  isNativeEth: boolean;
  chainLabel: string;
}

export const EVM_ASSETS: EvmAssetMeta[] = [
  {
    key: 'USDC',
    displaySymbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    isNativeEth: false,
    chainLabel: 'Ethereum',
  },
  {
    key: 'WETH',
    displaySymbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNativeEth: true,
    chainLabel: 'Ethereum',
  },
  {
    key: 'WSOL',
    displaySymbol: 'wSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    isNativeEth: false,
    chainLabel: 'Ethereum',
  },
];
