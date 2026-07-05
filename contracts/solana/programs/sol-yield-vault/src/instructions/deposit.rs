use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::VaultError;
use crate::events::Deposited;
use crate::state::{
    Position, Vault, MIN_INITIAL_DEPOSIT_LAMPORTS, POSITION_SEED, SOL_POOL_SEED, VAULT_SEED,
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, seeds = [SOL_POOL_SEED], bump = vault.pool_bump)]
    pub sol_pool: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount_lamports: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(!vault.paused, VaultError::VaultPaused);
    require!(amount_lamports > 0, VaultError::ZeroAmount);

    // Snapshot assets BEFORE moving the deposit in — share price must be
    // computed against the pre-deposit asset base.
    let assets_before = Vault::total_assets(ctx.accounts.sol_pool.lamports())?;

    // Deposit cap (0 == uncapped) is checked against post-deposit assets.
    if vault.deposit_cap_lamports > 0 {
        let assets_after = assets_before
            .checked_add(amount_lamports)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            assets_after <= vault.deposit_cap_lamports,
            VaultError::DepositCapExceeded
        );
    }

    if vault.total_shares == 0 {
        // Share-inflation attack guard: force a meaningful initial supply.
        require!(
            amount_lamports >= MIN_INITIAL_DEPOSIT_LAMPORTS,
            VaultError::BelowMinimumInitialDeposit
        );
    }

    let shares = Vault::shares_for_deposit(amount_lamports, vault.total_shares, assets_before)?;
    require!(shares > 0, VaultError::ZeroSharesMinted);

    // Pull the SOL into the pool PDA (user signs the system transfer).
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.sol_pool.to_account_info(),
            },
        ),
        amount_lamports,
    )?;

    let position = &mut ctx.accounts.position;
    position.owner = ctx.accounts.user.key();
    position.bump = ctx.bumps.position;
    position.shares = position
        .shares
        .checked_add(shares)
        .ok_or(VaultError::MathOverflow)?;

    vault.total_shares = vault
        .total_shares
        .checked_add(shares)
        .ok_or(VaultError::MathOverflow)?;
    vault.total_lamports_deposited = vault
        .total_lamports_deposited
        .checked_add(amount_lamports)
        .ok_or(VaultError::MathOverflow)?;

    let total_assets = Vault::total_assets(ctx.accounts.sol_pool.lamports())?;
    emit!(Deposited {
        user: ctx.accounts.user.key(),
        amount_lamports,
        shares_minted: shares,
        total_shares: vault.total_shares,
        total_assets,
    });

    Ok(())
}
