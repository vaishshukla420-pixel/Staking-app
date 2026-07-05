# Security notes

**Status: UNAUDITED.** This codebase has not had a professional security audit.
Do not deploy it to mainnet holding third-party funds without one. See the
"honest caveats" section of the README.

## Static analysis (Slither)

`slither . --filter-paths "node_modules|mocks" --exclude-informational
--exclude-optimization` was run against `contracts/evm` (Slither, 75 detectors).

**Result: no critical/high exploitable findings.** Fixes applied in response:

- `harvest()` is now an `external nonReentrant` wrapper around an internal
  `_harvest()` (used by `rebalance` / fee changes), so every state-mutating
  entry point is reentrancy-guarded.
- `emergencyWithdraw()` gained `nonReentrant` and was reordered
  effects-before-interactions (active strategy cleared and vault paused
  *before* the external `withdrawAll`).
- `rebalance()` reordered effects-before-interactions (`activeStrategy` and
  `lastRebalanceAt` written before external calls).
- `EthGateway` now reverts if the WETH `approve` returns false.

Remaining findings, reviewed and acknowledged (would be "acknowledged" in an
audit report):

| Finding | Why it's acceptable |
|---|---|
| `reentrancy-balance` in `_withdraw` | The balance IS re-read after the strategy call; Slither can't see the reassignment satisfies the later check. Path is `nonReentrant` and strategies are owner-whitelisted. |
| `reentrancy-no-eth` / `reentrancy-benign` in `rebalance` / `emergencyWithdraw` | `lastTotalAssets = totalAssets()` is a reconciliation that *must* run after funds move. Both functions are `nonReentrant`; only whitelisted strategies are ever called. |
| `arbitrary-send-eth` in `EthGateway._sendETH` | The "arbitrary" receiver is chosen by the caller and paid from the caller's own burned shares. |
| `incorrect-equality` (`== 0`, `== max`) | Zero-checks used as short-circuits and Aave's documented `max` sentinel — not equality-dependent logic. |
| `calls-loop` in `bestStrategy` | View helper over a small owner-curated list (3 strategies). |
| `timestamp` comparisons | Used for a 6-hour cooldown and 1-day APR staleness; miner drift of seconds is immaterial. |
| `unused-return` (Morpho adapter, `_withdraw`) | Return values are either re-derived from balances immediately afterwards or ERC-4626 previews not needed for correctness. |

## Protocol-level protections

- Performance fee comes only from profit above a high-water mark — never
  principal; fee hard-capped at 30%.
- Withdrawals can never be paused; deposits can.
- Permissionless rebalancing is self-verifying on-chain (min APR improvement +
  cooldown); only owner/keepers may bypass, and only to whitelisted strategies
  validated for matching asset and vault.
- ERC-4626 virtual-share offset of 1e6 makes first-depositor inflation attacks
  unprofitable (covered by a test).
- Two-step ownership transfer; `emergencyWithdraw` recall path.
- Solana program: u128 checked share math (floor favors the pool), rent-exempt
  reserve excluded from share accounting, shares burned before payout,
  minimum first deposit against share-inflation.

## Before mainnet (minimum bar)

1. Professional audit or a public audit contest (Code4rena / Sherlock).
2. Owner keys behind a multisig (Gnosis Safe) + timelock on parameter changes.
3. Tight deposit caps at launch; raise gradually.
4. Monitoring/alerts (e.g. OpenZeppelin Defender) and an Immunefi bug bounty.
5. Keeper redundancy (Chainlink Automation or Gelato) for rebalance/harvest.

## Reporting

Found a vulnerability? Please do not open a public issue — contact the
repository owner directly.
