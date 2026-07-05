// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Compound v3 (Comet) interface — base-asset supply side only.
interface IComet {
    function supply(address asset, uint256 amount) external;

    function withdrawTo(address to, address asset, uint256 amount) external;

    /// @notice Base-token balance including accrued interest
    function balanceOf(address account) external view returns (uint256);

    /// @notice Per-second supply rate scaled by 1e18, for a given utilization
    function getSupplyRate(uint256 utilization) external view returns (uint64);

    function getUtilization() external view returns (uint256);

    function baseToken() external view returns (address);
}
