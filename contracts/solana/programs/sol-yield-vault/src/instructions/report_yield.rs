use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::VaultError;
use crate::events::YieldReported;
use crate::state::{Vault, BPS_DENOMINATOR, SOL_POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct ReportYield<'info> {
    /// Permissionless: anyone (in production: the strategy adapter or the
    /// keeper) may report yield, because reporting requires actually PAYING
    /// the profit into the pool. There is nothing to grief — a malicious
    /// reporter can only donate lamports to shareholders and the treasury.
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, seeds = [SOL_POOL_SEED], bump = vault.pool_bump)]
    pub sol_pool: SystemAccount<'info>,

    /// CHECK: enforced to be the treasury recorded in vault state; it only
    /// receives lamports via a system transfer.
    #[account(
        mut,
        address = vault.treasury @ VaultError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_report_yield(ctx: Context<ReportYield>, profit_lamports: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(profit_lamports > 0, VaultError::ZeroAmount);
    // Yield with no shareholders would be unattributable; reject it so the
    // funds are not stranded (and cannot be scooped by the next depositor).
    require!(vault.total_shares > 0, VaultError::NoSharesOutstanding);

    // ------------------------------------------------------------------
    // integration point: in a real deployment this instruction would CPI
    // into the active venue (Marinade `LiquidUnstake` / Solend `Redeem` /
    // Kamino withdraw) to realize profit into the pool, instead of taking
    // lamports from the reporter. The fee split below stays identical.
    // ------------------------------------------------------------------

    // 1) Reporter pays the harvested profit into the pool.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reporter.to_account_info(),
                to: ctx.accounts.sol_pool.to_account_info(),
            },
        ),
        profit_lamports,
    )?;

    // 2) Performance fee = profit * fee_bps / 10_000 (u128 intermediate,
    //    floored — rounding dust favors shareholders, not the treasury).
    let fee_lamports = u64::try_from(
        (profit_lamports as u128)
            .checked_mul(vault.performance_fee_bps as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(VaultError::MathOverflow)?,
    )
    .map_err(|_| VaultError::MathOverflow)?;

    // 3) Route the fee from the pool to the treasury, signed by the pool PDA.
    if fee_lamports > 0 {
        let pool_signer_seeds: &[&[&[u8]]] = &[&[SOL_POOL_SEED, &[vault.pool_bump]]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sol_pool.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                pool_signer_seeds,
            ),
            fee_lamports,
        )?;
    }

    let net_profit_lamports = profit_lamports
        .checked_sub(fee_lamports)
        .ok_or(VaultError::MathOverflow)?;

    // 4) The remainder stays in the pool: total_assets rises while
    //    total_shares is unchanged, so the share price rises for everyone.
    let total_assets = Vault::total_assets(ctx.accounts.sol_pool.lamports())?;
    vault.last_harvest_assets = total_assets;

    emit!(YieldReported {
        reporter: ctx.accounts.reporter.key(),
        profit_lamports,
        fee_lamports,
        net_profit_lamports,
        total_assets,
    });

    Ok(())
}
