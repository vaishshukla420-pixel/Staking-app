use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::VaultError;
use crate::events::VaultInitialized;
use crate::state::{Vault, MAX_PERFORMANCE_FEE_BPS, SOL_POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Pays for account creation and funds the pool's rent-exempt reserve.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// Program-controlled, system-owned SOL pool PDA. It holds no data; the
    /// program moves lamports out of it by signing system transfers with the
    /// `"sol_pool"` seeds.
    #[account(
        mut,
        seeds = [SOL_POOL_SEED],
        bump,
    )]
    pub sol_pool: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    admin: Pubkey,
    treasury: Pubkey,
    performance_fee_bps: u16,
    deposit_cap_lamports: u64,
) -> Result<()> {
    require!(
        performance_fee_bps <= MAX_PERFORMANCE_FEE_BPS,
        VaultError::FeeTooHigh
    );

    let vault = &mut ctx.accounts.vault;
    vault.admin = admin;
    vault.treasury = treasury;
    vault.performance_fee_bps = performance_fee_bps;
    vault.total_shares = 0;
    vault.total_lamports_deposited = 0;
    vault.current_venue = 0; // Venue::Idle
    vault.reported_apr_bps = 0;
    vault.last_harvest_assets = 0;
    vault.paused = false;
    vault.deposit_cap_lamports = deposit_cap_lamports;
    vault.bump = ctx.bumps.vault;
    vault.pool_bump = ctx.bumps.sol_pool;

    // Fund the pool PDA with exactly its rent-exempt reserve so the account
    // persists. This reserve is excluded from total_assets forever, so it
    // never leaks into (or out of) the share price.
    let reserve = Vault::pool_rent_reserve()?;
    let top_up = reserve.saturating_sub(ctx.accounts.sol_pool.lamports());
    if top_up > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.sol_pool.to_account_info(),
                },
            ),
            top_up,
        )?;
    }

    emit!(VaultInitialized {
        admin,
        treasury,
        performance_fee_bps,
        deposit_cap_lamports,
    });

    Ok(())
}
