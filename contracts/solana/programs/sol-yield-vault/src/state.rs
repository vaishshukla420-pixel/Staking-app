use anchor_lang::prelude::*;

use crate::errors::VaultError;

/// Basis-point denominator (100% == 10_000 bps).
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Hard cap on the performance fee: 30%.
pub const MAX_PERFORMANCE_FEE_BPS: u16 = 3_000;
/// Minimum first deposit (0.001 SOL) — mitigates the classic share-inflation
/// ("first depositor") attack by forcing a non-dust initial share supply.
pub const MIN_INITIAL_DEPOSIT_LAMPORTS: u64 = 1_000_000;

/// PDA seeds.
pub const VAULT_SEED: &[u8] = b"vault";
pub const SOL_POOL_SEED: &[u8] = b"sol_pool";
pub const POSITION_SEED: &[u8] = b"position";

/// Venue labels. In this demo the venue is a recorded label only; the real
/// CPI integrations plug in at the marked `// integration point`s in
/// `instructions/rebalance.rs` and `instructions/report_yield.rs`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Venue {
    Idle = 0,
    Marinade = 1,
    Solend = 2,
    Kamino = 3,
}

impl Venue {
    pub fn try_from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Venue::Idle),
            1 => Ok(Venue::Marinade),
            2 => Ok(Venue::Solend),
            3 => Ok(Venue::Kamino),
            _ => Err(VaultError::InvalidVenue.into()),
        }
    }
}

/// Global vault state (PDA, seed `"vault"`).
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Admin authority (can rebalance, set params, force APR overrides).
    pub admin: Pubkey,
    /// Destination of performance fees.
    pub treasury: Pubkey,
    /// Performance fee on harvested yield, in bps (max 3000 = 30%).
    pub performance_fee_bps: u16,
    /// Total ledger shares outstanding across all positions.
    pub total_shares: u64,
    /// Lifetime cumulative lamports deposited by users (monotonic; a
    /// bookkeeping metric, NOT used in share math).
    pub total_lamports_deposited: u64,
    /// Current investment venue label (see [`Venue`]).
    pub current_venue: u8,
    /// APR (bps) reported for the current venue by the keeper/admin.
    pub reported_apr_bps: u16,
    /// Vault total assets snapshot taken at the end of the last
    /// `report_yield` harvest.
    pub last_harvest_assets: u64,
    /// When true, deposits are rejected (withdrawals always remain open).
    pub paused: bool,
    /// Max total assets accepted. 0 == uncapped.
    pub deposit_cap_lamports: u64,
    /// Bump of this vault state PDA.
    pub bump: u8,
    /// Bump of the `"sol_pool"` SOL-holding PDA.
    pub pool_bump: u8,
}

impl Vault {
    /// Rent-exempt reserve that must always remain in the pool PDA so the
    /// account survives. This reserve is *excluded* from `total_assets`, so
    /// share math never touches it and withdrawals can never close the pool.
    pub fn pool_rent_reserve() -> Result<u64> {
        Ok(Rent::get()?.minimum_balance(0))
    }

    /// Investable assets backing the shares: pool lamports minus the
    /// rent-exempt reserve.
    pub fn total_assets(pool_lamports: u64) -> Result<u64> {
        let reserve = Self::pool_rent_reserve()?;
        Ok(pool_lamports.saturating_sub(reserve))
    }

    /// shares minted = amount * total_shares / total_assets (floor),
    /// computed in u128 to avoid intermediate overflow.
    pub fn shares_for_deposit(
        amount: u64,
        total_shares: u64,
        total_assets: u64,
    ) -> Result<u64> {
        if total_shares == 0 {
            // First deposit: 1 share == 1 lamport.
            return Ok(amount);
        }
        require!(total_assets > 0, VaultError::MathOverflow);
        let shares = (amount as u128)
            .checked_mul(total_shares as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(total_assets as u128)
            .ok_or(VaultError::MathOverflow)?;
        u64::try_from(shares).map_err(|_| VaultError::MathOverflow.into())
    }

    /// lamports out = shares * total_assets / total_shares (floor),
    /// computed in u128 to avoid intermediate overflow.
    pub fn lamports_for_shares(
        shares: u64,
        total_shares: u64,
        total_assets: u64,
    ) -> Result<u64> {
        require!(total_shares > 0, VaultError::NoSharesOutstanding);
        let lamports = (shares as u128)
            .checked_mul(total_assets as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(total_shares as u128)
            .ok_or(VaultError::MathOverflow)?;
        u64::try_from(lamports).map_err(|_| VaultError::MathOverflow.into())
    }
}

/// Per-depositor share ledger (PDA, seed `"position" + user`).
#[account]
#[derive(InitSpace)]
pub struct Position {
    /// The depositor this position belongs to (redundant with the PDA seed,
    /// kept for off-chain auditability).
    pub owner: Pubkey,
    /// Ledger shares held by this depositor.
    pub shares: u64,
    /// PDA bump.
    pub bump: u8,
}
