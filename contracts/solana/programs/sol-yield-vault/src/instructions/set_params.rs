use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::events::ParamsUpdated;
use crate::state::{Vault, MAX_PERFORMANCE_FEE_BPS, VAULT_SEED};

#[derive(Accounts)]
pub struct SetParams<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault.bump,
        has_one = admin @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_set_params(
    ctx: Context<SetParams>,
    performance_fee_bps: u16,
    deposit_cap_lamports: u64,
    paused: bool,
) -> Result<()> {
    require!(
        performance_fee_bps <= MAX_PERFORMANCE_FEE_BPS,
        VaultError::FeeTooHigh
    );

    let vault = &mut ctx.accounts.vault;
    vault.performance_fee_bps = performance_fee_bps;
    vault.deposit_cap_lamports = deposit_cap_lamports;
    vault.paused = paused;

    emit!(ParamsUpdated {
        performance_fee_bps,
        deposit_cap_lamports,
        paused,
    });

    Ok(())
}
