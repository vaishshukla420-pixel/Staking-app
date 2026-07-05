//! # sol_yield_vault
//!
//! SOL yield vault — the Solana half of the dual-chain "Staking App"
//! protocol (economic twin of the ERC-4626-style EVM vault):
//!
//! * Users deposit SOL into a program-owned pool PDA and receive
//!   ledger-based shares (no SPL mint) recorded in a per-user Position PDA.
//! * Harvested yield is paid into the pool via `report_yield`; the protocol
//!   skims a performance fee (bps, max 30%) to the treasury and the rest
//!   accrues to the share price.
//! * A keeper/admin records venue rebalances (Idle / Marinade / Solend /
//!   Kamino) justified by a strictly improving reported APR. Real venue
//!   CPIs plug in at the marked `// integration point`s.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder program id. Before a real deploy, generate a keypair
// (`solana-keygen new -o target/deploy/sol_yield_vault-keypair.json`) and run
// `anchor keys sync` to replace this id here and in Anchor.toml.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod sol_yield_vault {
    use super::*;

    /// Create the vault state PDA and the SOL pool PDA; set admin,
    /// treasury, performance fee (bps, <= 3000) and deposit cap
    /// (0 == uncapped).
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        treasury: Pubkey,
        performance_fee_bps: u16,
        deposit_cap_lamports: u64,
    ) -> Result<()> {
        handle_initialize(
            ctx,
            admin,
            treasury,
            performance_fee_bps,
            deposit_cap_lamports,
        )
    }

    /// Deposit SOL, minting shares at the current share price. The first
    /// deposit must be >= 1_000_000 lamports and mints 1 share per lamport.
    pub fn deposit(ctx: Context<Deposit>, amount_lamports: u64) -> Result<()> {
        handle_deposit(ctx, amount_lamports)
    }

    /// Burn shares and withdraw the proportional lamports from the pool.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        handle_withdraw(ctx, shares)
    }

    /// Permissionless-payable harvest: the reporter transfers
    /// `profit_lamports` into the pool; the program routes
    /// `profit * fee_bps / 10_000` to the treasury and leaves the remainder
    /// to accrue to the share price.
    pub fn report_yield(ctx: Context<ReportYield>, profit_lamports: u64) -> Result<()> {
        handle_report_yield(ctx, profit_lamports)
    }

    /// Admin/keeper-only: record a venue switch. Requires
    /// `new_apr_bps > reported_apr_bps` unless `force` is set.
    pub fn rebalance(
        ctx: Context<Rebalance>,
        new_venue: u8,
        new_apr_bps: u16,
        force: bool,
    ) -> Result<()> {
        handle_rebalance(ctx, new_venue, new_apr_bps, force)
    }

    /// Admin-only parameter update (fee capped at 3000 bps).
    pub fn set_params(
        ctx: Context<SetParams>,
        performance_fee_bps: u16,
        deposit_cap_lamports: u64,
        paused: bool,
    ) -> Result<()> {
        handle_set_params(ctx, performance_fee_bps, deposit_cap_lamports, paused)
    }
}

#[cfg(test)]
mod tests {
    use crate::state::Vault;

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(Vault::shares_for_deposit(1_000_000, 0, 0).unwrap(), 1_000_000);
    }

    #[test]
    fn share_math_round_trips_with_profit() {
        // 10 SOL deposited, 1 SOL net profit accrued -> assets 11e9, shares 10e9.
        let total_shares = 10_000_000_000u64;
        let total_assets = 11_000_000_000u64;
        // A new 1 SOL deposit mints floor(1e9 * 10e9 / 11e9) shares.
        let minted = Vault::shares_for_deposit(1_000_000_000, total_shares, total_assets).unwrap();
        assert_eq!(minted, 909_090_909);
        // Redeeming all original shares pays out pro-rata of the enlarged pool.
        let out = Vault::lamports_for_shares(total_shares, total_shares, total_assets).unwrap();
        assert_eq!(out, total_assets);
    }

    #[test]
    fn share_math_uses_u128_intermediates() {
        // Values that would overflow u64 multiplication.
        let total_shares = u64::MAX / 2;
        let total_assets = u64::MAX / 2;
        let minted = Vault::shares_for_deposit(1_000, total_shares, total_assets).unwrap();
        assert_eq!(minted, 1_000);
    }
}
