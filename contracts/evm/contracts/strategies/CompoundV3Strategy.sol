// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseStrategy} from "./BaseStrategy.sol";
import {IComet} from "../interfaces/compound/IComet.sol";

/// @title CompoundV3Strategy — supplies the vault's asset to a Compound v3 (Comet) market
/// @notice Only valid when `asset` is the Comet market's base token. APR is
///         derived from the on-chain per-second supply rate at current utilization.
contract CompoundV3Strategy is BaseStrategy {
    using SafeERC20 for IERC20;

    IComet public immutable comet;

    uint256 private constant SECONDS_PER_YEAR = 365 days;

    error AssetNotBaseToken();

    constructor(address vault_, address asset_, address comet_) BaseStrategy(vault_, asset_) {
        if (comet_ == address(0)) revert ZeroAddress();
        if (IComet(comet_).baseToken() != asset_) revert AssetNotBaseToken();
        comet = IComet(comet_);
    }

    function name() external pure override returns (string memory) {
        return "Compound v3";
    }

    function totalAssets() public view override returns (uint256) {
        return comet.balanceOf(address(this));
    }

    function currentAPRBps() external view override returns (uint256) {
        // per-second rate scaled 1e18 -> annualized bps
        uint256 ratePerSecond = comet.getSupplyRate(comet.getUtilization());
        return (ratePerSecond * SECONDS_PER_YEAR * 10_000) / 1e18;
    }

    function deposit(uint256 amount) external override onlyVault {
        IERC20(asset).forceApprove(address(comet), amount);
        comet.supply(asset, amount);
    }

    function withdraw(uint256 amount, address to) public override onlyVault returns (uint256) {
        comet.withdrawTo(to, asset, amount);
        return amount;
    }

    function withdrawAll(address to) external override onlyVault returns (uint256) {
        uint256 balance = comet.balanceOf(address(this));
        if (balance == 0) return 0;
        comet.withdrawTo(to, asset, balance);
        return balance;
    }
}
