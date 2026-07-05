// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStrategy — adapter between a YieldVault and an external yield venue
/// @notice Exactly one strategy is active per vault at a time. The vault
///         transfers assets to the strategy and calls `deposit`; the strategy
///         supplies them to its venue (Aave, Compound, Morpho, ...).
interface IStrategy {
    /// @notice Underlying asset the strategy accepts (must match the vault's asset)
    function asset() external view returns (address);

    /// @notice The only vault allowed to move funds through this strategy
    function vault() external view returns (address);

    /// @notice Human-readable venue name, e.g. "Aave v3"
    function name() external view returns (string memory);

    /// @notice Total assets (principal + accrued yield) held at the venue
    function totalAssets() external view returns (uint256);

    /// @notice Current gross supply APR at the venue, in basis points (100 = 1%)
    function currentAPRBps() external view returns (uint256);

    /// @notice Supply `amount` of assets already transferred to this strategy into the venue
    function deposit(uint256 amount) external;

    /// @notice Withdraw `amount` of assets from the venue to `to`; returns amount actually sent
    function withdraw(uint256 amount, address to) external returns (uint256);

    /// @notice Withdraw everything from the venue to `to`; returns amount sent
    function withdrawAll(address to) external returns (uint256);
}
