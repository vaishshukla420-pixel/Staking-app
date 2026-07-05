# YieldVault — EVM contracts

ERC-4626 yield vaults (USDC / WETH / wSOL) that auto-allocate deposits across
**Aave v3, Compound v3, and Morpho**, moving all funds to whichever venue pays
the highest APR. The protocol earns a **performance fee on yield only**
(default 20%, hard-capped at 30%) minted to the treasury as vault shares.

## Layout

| Path | What |
|---|---|
| `contracts/YieldVault.sol` | ERC-4626 vault: share accounting, harvest/fee, rebalancing, safety rails |
| `contracts/interfaces/IStrategy.sol` | Venue adapter interface |
| `contracts/strategies/AaveV3Strategy.sol` | Aave v3 adapter — APR read on-chain from `currentLiquidityRate` |
| `contracts/strategies/CompoundV3Strategy.sol` | Compound v3 (Comet) adapter — APR from on-chain per-second supply rate |
| `contracts/strategies/MorphoStrategy.sol` | Morpho / any ERC-4626 venue — APR pushed by a keeper reporter, stale ⇒ 0 |
| `contracts/EthGateway.sol` | Deposit/withdraw native ETH against the WETH vault |
| `contracts/mocks/` | Mock tokens + venue simulators with settable APRs (tests/demos only) |
| `scripts/deploy-local.js` | Full mock stack on localhost, writes `deployments/<network>.json` |
| `scripts/deploy-testnet.js` | Deploy against real venue addresses from `config/sepolia.json` |

## How the money flows

1. `deposit()` mints shares and pushes the assets into the **active strategy**.
2. The strategy supplies them to its venue; interest accrues to the venue balance,
   so `totalAssets()` — and with it the share price — rises continuously.
3. `rebalance(newStrategy)` moves **everything** to a better venue.
   Permissionless when `newAPR ≥ currentAPR + minRebalanceImprovementBps`
   (default 50 bps) and the cooldown (default 6 h) passed — the contract checks
   profitability itself, so any keeper (Chainlink Automation, Gelato, a cron
   job) can trigger it trustlessly. Owner/keepers may force a move (venue risk).
4. `harvest()` (also run inside every rebalance) measures profit above the
   high-water mark and mints the treasury shares worth `performanceFeeBps` of
   it. Principal is never touched; no profit ⇒ no fee.

Safety: reentrancy guards, pausable deposits (withdrawals are **never**
pausable), deposit caps, strategy whitelist with asset/vault validation,
`emergencyWithdraw()` recall, ERC-4626 virtual-share offset (1e6) against
first-depositor inflation attacks, two-step ownership transfer.

## Commands

```bash
npm install
npm test                 # 26 tests: accounting, fees, rebalancing, gateway, attacks
npm run node             # terminal 1: local chain
npm run deploy:local     # terminal 2: mock stack + demo balances
npm run deploy:sepolia   # after filling config/sepolia.json (see its _comment)
```

> **Warning** — unaudited demo code. Do not hold real funds with it before a
> professional audit.
