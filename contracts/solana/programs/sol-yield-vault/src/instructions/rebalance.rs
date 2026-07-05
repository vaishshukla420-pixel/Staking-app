use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::events::Rebalanced;
use crate::state::{Vault, Venue, VAULT_SEED};

#[derive(Accounts)]
pub struct Rebalance<'info> {
    /// The vault admin (acts as the keeper authority in this demo).
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault.bump,
        has_one = admin @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_rebalance(
    ctx: Context<Rebalance>,
    new_venue: u8,
    new_apr_bps: u16,
    force: bool,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Validate the venue label.
    Venue::try_from_u8(new_venue)?;

    // A rebalance must be justified by a strictly better reported APR,
    // unless the admin explicitly forces it (e.g. de-risking a venue).
    if !force {
        require!(
            new_apr_bps > vault.reported_apr_bps,
            VaultError::AprNotImproved
        );
    }

    let old_venue = vault.current_venue;
    let old_apr_bps = vault.reported_apr_bps;

    // ------------------------------------------------------------------
    // integration point: real venue moves happen here.
    //   * exit old venue:
    //       Marinade -> CPI marinade_finance::liquid_unstake (mSOL -> SOL)
    //       Solend   -> CPI solend::redeem_reserve_collateral (cSOL -> SOL)
    //       Kamino   -> CPI kamino_lend::withdraw_obligation_collateral
    //   * enter new venue:
    //       Marinade -> CPI marinade_finance::deposit (SOL -> mSOL)
    //       Solend   -> CPI solend::deposit_reserve_liquidity (SOL -> cSOL)
    //       Kamino   -> CPI kamino_lend::deposit_reserve_liquidity
    //   The venue token accounts would be additional PDAs owned by this
    //   program, and total_assets() would be extended to value those
    //   receipt tokens. In this demo the SOL stays in the sol_pool PDA and
    //   only the label + APR are recorded.
    // ------------------------------------------------------------------

    vault.current_venue = new_venue;
    vault.reported_apr_bps = new_apr_bps;

    emit!(Rebalanced {
        authority: ctx.accounts.admin.key(),
        old_venue,
        new_venue,
        old_apr_bps,
        new_apr_bps,
        forced: force,
    });

    Ok(())
}
