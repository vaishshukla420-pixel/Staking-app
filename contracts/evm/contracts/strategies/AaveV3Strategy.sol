// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseStrategy} from "./BaseStrategy.sol";
import {IAaveV3Pool} from "../interfaces/aave/IAaveV3Pool.sol";

/// @title AaveV3Strategy — supplies the vault's asset to an Aave v3 pool
/// @notice APR is read directly from Aave's on-chain `currentLiquidityRate`
///         (ray, 1e27), so the rebalancer needs no oracle for this venue.
contract AaveV3Strategy is BaseStrategy {
    using SafeERC20 for IERC20;

    IAaveV3Pool public immutable pool;
    /// @dev Aave's interest-bearing receipt token for `asset`
    IERC20 public immutable aToken;

    uint256 private constant RAY_TO_BPS = 1e23; // 1e27 (ray) / 1e4 (bps)

    constructor(address vault_, address asset_, address pool_, address aToken_)
        BaseStrategy(vault_, asset_)
    {
        if (pool_ == address(0) || aToken_ == address(0)) revert ZeroAddress();
        pool = IAaveV3Pool(pool_);
        aToken = IERC20(aToken_);
    }

    function name() external pure override returns (string memory) {
        return "Aave v3";
    }

    function totalAssets() public view override returns (uint256) {
        // aToken balances rebase with interest 1:1 against the underlying
        return aToken.balanceOf(address(this));
    }

    function currentAPRBps() external view override returns (uint256) {
        return uint256(pool.getReserveData(asset).currentLiquidityRate) / RAY_TO_BPS;
    }

    function deposit(uint256 amount) external override onlyVault {
        IERC20(asset).forceApprove(address(pool), amount);
        pool.supply(asset, amount, address(this), 0);
    }

    function withdraw(uint256 amount, address to) public override onlyVault returns (uint256) {
        return pool.withdraw(asset, amount, to);
    }

    function withdrawAll(address to) external override onlyVault returns (uint256) {
        if (totalAssets() == 0) return 0;
        // type(uint256).max is Aave's sentinel for "entire balance"
        return pool.withdraw(asset, type(uint256).max, to);
    }
}
