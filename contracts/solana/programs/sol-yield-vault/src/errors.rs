use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Performance fee exceeds the 3000 bps (30%) maximum")]
    FeeTooHigh,
    #[msg("Vault is paused: deposits are disabled")]
    VaultPaused,
    #[msg("Deposit would exceed the vault deposit cap")]
    DepositCapExceeded,
    #[msg("First deposit must be at least 1_000_000 lamports")]
    BelowMinimumInitialDeposit,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deposit too small: would mint zero shares")]
    ZeroSharesMinted,
    #[msg("Withdrawal would return zero lamports")]
    ZeroLamportsOut,
    #[msg("Insufficient shares in position")]
    InsufficientShares,
    #[msg("No shares outstanding")]
    NoSharesOutstanding,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unknown venue: expected 0=Idle, 1=Marinade, 2=Solend, 3=Kamino")]
    InvalidVenue,
    #[msg("New APR must strictly beat the current reported APR (or pass force)")]
    AprNotImproved,
    #[msg("Signer is not the vault admin")]
    Unauthorized,
    #[msg("Treasury account does not match the vault's configured treasury")]
    InvalidTreasury,
    #[msg("Pool balance is insufficient for this transfer")]
    InsufficientPoolBalance,
}
