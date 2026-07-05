# YieldVault — Frontend

Dark-themed Next.js 14 (app router) frontend for the YieldVault dual-chain
yield protocol: ERC-4626 vaults for **USDC / ETH / wSOL** on Ethereum, plus a
native-**SOL** vault on Solana. Deposits are auto-invested across
Aave v3 / Compound v3 / Morpho (Marinade / Solend / Kamino on Solana); a
keeper rebalances to the highest APY and the protocol takes a performance fee
on yield only.

## Stack

- Next.js 14 + TypeScript, Tailwind CSS (system font stack — fully self-contained, no CDNs)
- wagmi v2 + viem + @tanstack/react-query, RainbowKit (EVM wallets)
- @solana/web3.js + @solana/wallet-adapter-react / -react-ui (Phantom, Solflare)

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build (must pass with zero errors)
npm run typecheck    # tsc --noEmit
npm start            # serve the production build
```

## Pointing at a network

Copy the env template and edit it:

```bash
cp .env.example .env.local
```

### Local hardhat node (default)

- `NEXT_PUBLIC_DEFAULT_CHAIN_ID=31337`
- `NEXT_PUBLIC_RPC_URL_LOCAL=http://127.0.0.1:8545`

Start the node from `../contracts` (`npx hardhat node`), deploy, then paste
addresses (see below). Add the "Localhost 31337" network to MetaMask
(RPC `http://127.0.0.1:8545`, chain id `31337`).

### Sepolia

- `NEXT_PUBLIC_DEFAULT_CHAIN_ID=11155111`
- `NEXT_PUBLIC_RPC_URL_SEPOLIA=<your RPC url>` (defaults to the public
  `https://rpc.sepolia.org`)

### Solana

- `NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899` (local `solana-test-validator`)
  or a devnet RPC url.
- `NEXT_PUBLIC_SOL_PROGRAM_ID=<deployed sol_yield_vault program id>`

Until the program id is set, the SOL card shows a "not deployed" state.

### WalletConnect (optional)

Injected wallets (MetaMask extension, etc.) work out of the box. To also offer
WalletConnect-based wallets, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to a
WalletConnect Cloud project id.

## Where to paste deployed addresses

Two options (env wins over file):

1. **Env vars** — fill the `NEXT_PUBLIC_*_VAULT_*`, `NEXT_PUBLIC_*_TOKEN_*`
   and `NEXT_PUBLIC_ETH_GATEWAY_*` entries in `.env.local`
   (suffix `_31337` for localhost, `_11155111` for sepolia).
2. **Source** — edit the placeholder zero addresses in
   [`src/config/contracts.ts`](src/config/contracts.ts) (`CONTRACTS` map:
   `vaults.USDC/WETH/WSOL.{vault,asset}` and `ethGateway` per chain).

Any address left as the zero address renders that card in a graceful
"not deployed" state — the UI never crashes on missing deployments.

Restart `npm run dev` after changing env vars (Next.js inlines
`NEXT_PUBLIC_*` at build time).

## Code map

| Path | Purpose |
| --- | --- |
| `src/config/contracts.ts` | Per-chain address maps, chain ids, RPC urls, asset metadata |
| `src/config/abis.ts` | Typed ABIs: YieldVault (ERC-4626 + custom views), IStrategy, ERC20, EthGateway |
| `src/config/wagmi.ts` | wagmi + RainbowKit config (localhost 31337 + sepolia) |
| `src/lib/solana.ts` | `sol_yield_vault` client: PDAs, state decoding, deposit/withdraw instruction builders |
| `src/lib/costBasis.ts` | Local (browser) cost-basis tracking used for the "Earned" stat |
| `src/components/EvmVaultCard.tsx` | USDC / ETH / wSOL cards: stats, approve→deposit, withdraw, gateway flow for ETH |
| `src/components/SolVaultCard.tsx` | Native SOL card against the Solana program |

## Behavior notes

- **ETH card** uses the `EthGateway`: deposits send native ETH (no approval);
  withdrawals first ask for a one-time vault-share approval for the gateway.
- **ERC-20 deposits** run an allowance check and chain approve → deposit
  automatically in one flow.
- **"Earned"** is derived from a locally tracked cost basis (localStorage) on
  the EVM side, and from the position account's `deposited_lamports` field on
  Solana when available; it degrades to "n/a" instead of guessing.
- All reads poll every 10 s; disconnected wallet, wrong network, unreachable
  RPC and undeployed contracts each render explicit non-crashing states.
