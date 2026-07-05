# sol_yield_vault — Solana SOL Yield Vault

The Solana half of the dual-chain **Staking App** yield protocol. Users
deposit SOL into a program-owned vault, the vault "invests" it via pluggable
venue strategies, depositors earn yield through a rising share price, and the
protocol keeps a performance fee (spread) on harvested yield that is routed
to a treasury. It is the economic twin of the ERC-4626-style EVM vault built
in `contracts/evm`.

Built with **Anchor (anchor-lang 0.31.1)**.

## Architecture

| Account | Seeds | Contents |
| --- | --- | --- |
| `Vault` (state PDA) | `["vault"]` | admin, treasury, `performance_fee_bps` (max 3000), `total_shares`, `total_lamports_deposited` (lifetime, bookkeeping only), `current_venue`, `reported_apr_bps`, `last_harvest_assets`, `paused`, `deposit_cap_lamports` (0 = uncapped), bumps |
| SOL pool (system PDA) | `["sol_pool"]` | Data-free, system-owned PDA that holds all vault SOL. The program moves lamports out by signing system transfers with the pool seeds. |
| `Position` (per user) | `["position", user]` | `owner`, `shares` — a ledger-based share balance. No SPL mint: simpler, cheaper, and trivially auditable. |

Venues are recorded labels in this demo: `0 = Idle, 1 = Marinade, 2 = Solend,
3 = Kamino`.

## Share math

Shares work exactly like ERC-4626, floored and computed in `u128`:

```
total_assets       = lamports(sol_pool) - rent_exempt_reserve(0 bytes)

deposit:  shares   = amount * total_shares / total_assets      (first deposit: shares = amount)
withdraw: lamports = shares * total_assets / total_shares
```

Key details:

- **Rent reserve is invisible to share math.** `initialize` funds the pool
  PDA with exactly its rent-exempt minimum, and `total_assets` subtracts that
  reserve forever. Withdrawals therefore can never de-rent the pool, and the
  reserve never inflates or dilutes the share price.
- **Share-inflation guard.** The first deposit must be at least
  `1_000_000` lamports and mints 1 share per lamport, so a griefer cannot
  mint 1 share and then donate lamports to round later depositors down to 0
  shares. Deposits that would mint 0 shares are rejected outright.
- **All arithmetic is checked**, with `u128` intermediates for every
  multiply-then-divide.

## Fee model

`report_yield(profit_lamports)` is *permissionless but payable*: whoever
calls it (in production the strategy adapter / keeper) transfers
`profit_lamports` into the pool in the same instruction. The program then
splits it:

```
fee        = profit * performance_fee_bps / 10_000     → treasury
net profit = profit - fee                              → stays in pool
```

The net profit raises `total_assets` while `total_shares` is unchanged, so
the share price rises for all depositors — identical to the EVM vault's
performance-fee-on-harvest model. `performance_fee_bps` is capped at
**3000 (30%)** at both `initialize` and `set_params`. Fee rounding is floored
(dust favors shareholders). Reporting is safe to leave permissionless because
a caller can only *donate* value.

## Instructions

| Instruction | Access | Behavior |
| --- | --- | --- |
| `initialize(admin, treasury, fee_bps, deposit_cap)` | anyone (once) | Creates vault + pool PDAs, funds the pool's rent reserve, `fee_bps <= 3000`. |
| `deposit(amount_lamports)` | anyone | Checks `paused` and deposit cap (against post-deposit assets), transfers SOL user → pool, mints shares at the current price. |
| `withdraw(shares)` | position owner | Burns shares, pays `shares * total_assets / total_shares` pool → user. Never paused. |
| `report_yield(profit_lamports)` | anyone (pays profit in) | Splits profit into treasury fee + share-price accrual; updates `last_harvest_assets`. Requires outstanding shares. |
| `rebalance(new_venue, new_apr_bps, force)` | admin | Records the venue + APR. Requires `new_apr_bps > reported_apr_bps` unless `force` (for de-risking). |
| `set_params(fee_bps, deposit_cap, paused)` | admin | Fee capped at 3000 bps; cap `0` = uncapped. |

Every state transition emits an Anchor event (`VaultInitialized`,
`Deposited`, `Withdrawn`, `YieldReported`, `Rebalanced`, `ParamsUpdated`).

## Where real venue integration plugs in

The demo keeps SOL in the pool PDA and records venues as labels. The
production hooks are marked with `// integration point` comments:

- **`instructions/rebalance.rs`** — exit/enter venue CPIs:
  - Marinade: `marinade_finance::deposit` (SOL → mSOL) /
    `liquid_unstake` (mSOL → SOL)
  - Solend: `deposit_reserve_liquidity` (SOL → cSOL) /
    `redeem_reserve_collateral`
  - Kamino: `kamino_lend::deposit_reserve_liquidity` / obligation withdraw
  - Receipt tokens (mSOL/cSOL/kTokens) would live in additional
    program-owned token-account PDAs, and `Vault::total_assets` would be
    extended to value them at their current exchange rate.
- **`instructions/report_yield.rs`** — instead of the reporter paying profit
  in, the harvest would CPI into the active venue to realize yield into the
  pool. The fee split downstream is unchanged.

## Building & testing (real toolchain)

This repo was authored in an environment without the Solana/Anchor CLIs, so
verification here is `cargo check` on the host target. With the real
toolchain (Rust + Solana CLI + Anchor CLI 0.31.1 + Node/yarn):

```bash
cd contracts/solana

# 1. Build (first build generates target/deploy/sol_yield_vault-keypair.json)
anchor build

# 2. Sync the real program id into lib.rs + Anchor.toml, rebuild
anchor keys sync
anchor build

# 3. Run the TypeScript integration tests against a local validator
yarn install
anchor test

# 4. Deploy (example: devnet)
anchor deploy --provider.cluster devnet
```

> **Program id note:** `declare_id!` currently holds a fixed placeholder
> (`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`); no keypair for it is
> committed. `anchor keys sync` after the first build replaces it everywhere.

Host-side verification without the Solana toolchain:

```bash
cd contracts/solana
cargo check     # must pass with zero errors
cargo test      # runs the share-math unit tests in lib.rs
```

The integration tests in `tests/sol-yield-vault.ts` cover: initialization,
minimum-first-deposit and 1:1 first mint, permissionless yield reporting with
the exact treasury fee split, deposits priced at an appreciated share price,
withdrawal of principal + profit (pool stays rent-exempt), rebalance
permissioning (non-admin rejected, APR must strictly improve, admin `force`
override, invalid venue), fee cap, deposit cap, and pause semantics
(deposits blocked, withdrawals always open).

## Security notes

- Checked math everywhere; overflow aborts the instruction.
- Checks-effects-interactions ordering on withdraw (shares burned before the
  lamport transfer).
- `report_yield` enforces the treasury address recorded in vault state.
- Pausing only gates deposits — users can always exit.
- `total_lamports_deposited` is a lifetime cumulative counter for analytics;
  it is never used in pricing.
