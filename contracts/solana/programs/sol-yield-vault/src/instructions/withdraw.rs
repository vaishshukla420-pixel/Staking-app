use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::VaultError;
use crate::events::Withdrawn;
use crate::state::{Position, Vault, POSITION_SEED, SOL_POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, seeds = [SOL_POOL_SEED], bump = vault.pool_bump)]
    pub sol_pool: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let position = &mut ctx.accounts.position;

    require!(shares > 0, VaultError::ZeroAmount);
    require!(position.shares >= shares, VaultError::InsufficientShares);

    let total_assets = Vault::total_assets(ctx.accounts.sol_pool.lamports())?;
    let lamports_out = Vault::lamports_for_shares(shares, vault.total_shares, total_assets)?;
    require!(lamports_out > 0, VaultError::ZeroLamportsOut);
    // total_assets already excludes the pool's rent-exempt reserve, so this
    // check also guarantees the pool PDA stays rent-exempt after payout.
    require!(lamports_out <= total_assets, VaultError::InsufficientPoolBalance);

    // Burn the shares first (checks-effects-interactions ordering).
    position.shares = position
        .shares
        .checked_sub(shares)
        .ok_or(VaultError::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_sub(shares)
        .ok_or(VaultError::MathOverflow)?;

    // Pay the user from the pool PDA. The pool is a system-owned, data-free
    // PDA, so the program signs a system transfer with its seeds.
    let pool_signer_seeds: &[&[&[u8]]] = &[&[SOL_POOL_SEED, &[vault.pool_bump]]];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sol_pool.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            pool_signer_seeds,
        ),
        lamports_out,
    )?;

    let total_assets_after = Vault::total_assets(ctx.accounts.sol_pool.lamports())?;
    emit!(Withdrawn {
        user: ctx.accounts.user.key(),
        shares_burned: shares,
        lamports_out,
        total_shares: vault.total_shares,
        total_assets: total_assets_after,
    });

    Ok(())
}
