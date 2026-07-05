use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub performance_fee_bps: u16,
    pub deposit_cap_lamports: u64,
}

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub amount_lamports: u64,
    pub shares_minted: u64,
    pub total_shares: u64,
    pub total_assets: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub shares_burned: u64,
    pub lamports_out: u64,
    pub total_shares: u64,
    pub total_assets: u64,
}

#[event]
pub struct YieldReported {
    pub reporter: Pubkey,
    pub profit_lamports: u64,
    pub fee_lamports: u64,
    pub net_profit_lamports: u64,
    pub total_assets: u64,
}

#[event]
pub struct Rebalanced {
    pub authority: Pubkey,
    pub old_venue: u8,
    pub new_venue: u8,
    pub old_apr_bps: u16,
    pub new_apr_bps: u16,
    pub forced: bool,
}

#[event]
pub struct ParamsUpdated {
    pub performance_fee_bps: u16,
    pub deposit_cap_lamports: u64,
    pub paused: bool,
}
