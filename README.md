# YieldVault — cross-chain yield protocol

Deposit **USDC, ETH, or SOL** → the protocol invests it in the highest-paying
lending venue → you earn yield through a rising share price → the protocol
keeps a performance fee on the yield (the spread). Fully non-custodial: all
accounting, fee math, and rebalancing rules are enforced on-chain.

```
                        ┌──────────────────────── Ethereum ────────────────────────┐
 user ── USDC/ETH/wSOL ─▶ YieldVault (ERC-4626, one per asset)                     │
                        │   │ shares minted; share price = totalAssets/totalShares │
                        │   ▼                                                      │
                        │ active IStrategy ──▶ Aave v3 / Compound v3 / Morpho      │
                        │   ▲                                                      │
                        │ rebalance(): anyone may move funds to a venue paying     │
                        │ ≥ +50 bps APR (checked on-chain); keeper may force       │
                        │ harvest(): 20% of profit → treasury as shares            │
                        └──────────────────────────────────────────────────────────┘

                        ┌───────────────────────── Solana ─────────────────────────┐
 user ────── SOL ───────▶ sol_yield_vault (Anchor program)                         │
                        │ PDA pool + share ledger, same share/fee math,            │
                        │ venue routing recorded on-chain (Marinade/Solend/Kamino  │
                        │ CPI integration points marked in code)                   │
                        └──────────────────────────────────────────────────────────┘
```

## Packages

| Package | Stack | Status |
|---|---|---|
| [`contracts/evm`](contracts/evm) | Solidity 0.8.28, Hardhat, OpenZeppelin 5 | 26/26 tests passing |
| [`contracts/solana`](contracts/solana) | Rust, Anchor 0.31 | `cargo check` clean, unit tests passing |
| [`frontend`](frontend) | Next.js, wagmi/viem + RainbowKit, Solana wallet adapter | builds clean |

## How the yield & spread work

1. You deposit 1,000 USDC → receive shares at the current share price.
2. The vault supplies the pooled funds to the venue with the best APR
   (read on-chain from Aave's `currentLiquidityRate` / Compound's supply rate;
   Morpho's rate is pushed by a keeper and expires if stale).
3. When another whitelisted venue pays **≥ 0.5% more APR**, *anyone* can call
   `rebalance()` — the contract itself verifies the improvement and a 6-hour
   cooldown, so keeper bots need no trust. The team can force-move on risk.
4. `harvest()` measures profit above the high-water mark and mints the
   treasury shares worth **20% of the profit** (hard cap 30%). Fees only ever
   come out of yield — never principal — and each unit of profit is charged once.
5. You withdraw any time: shares burn at the current (higher) share price.
   Withdrawals can never be paused.

Example: strategy earns 6% APY → you receive ~4.8% net, protocol keeps ~1.2%.

## Quick start

```bash
# 1. EVM contracts — test and run a full local demo stack
cd contracts/evm && npm install
npm test
npm run node             # terminal 1
npm run deploy:local     # terminal 2 → prints/saves all addresses

# 2. Frontend
cd ../../frontend && npm install
# paste addresses from contracts/evm/deployments/localhost.json into src/config/contracts.ts
npm run dev              # http://localhost:3000

# 3. Solana program (requires Solana + Anchor toolchain)
cd ../contracts/solana && anchor build && anchor test
```

Each package README has the details, including Sepolia testnet deployment
against the real Aave/Compound/Morpho deployments (`contracts/evm/config/sepolia.json`).

## Design notes & honest caveats

- **SOL on Ethereum** means a wrapped-SOL ERC-20 (e.g. Wormhole SOL); native
  SOL is handled by the Solana program. The two chains run independent
  deployments of the same economic design — there is no cross-chain bridge in
  this codebase.
- **Rebalancing** moves 100% of funds to the single best venue. Splitting
  across venues (utilization-aware allocation) is the natural v2.
- **Morpho APR** is keeper-reported (MetaMorpho vaults don't expose a rate
  on-chain); a stale report reads as 0 so funds never move *into* Morpho on
  stale data.
- **Unaudited.** This is a complete, tested reference implementation — get a
  professional audit, add a timelock + multisig on owner powers, and start
  with tight deposit caps before putting real money behind it.
