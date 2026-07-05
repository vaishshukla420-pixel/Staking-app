// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseStrategy} from "./BaseStrategy.sol";

/// @title MorphoStrategy — deposits into a Morpho (MetaMorpho) ERC-4626 vault
/// @notice MetaMorpho vaults don't expose a supply rate on-chain, so the APR
///         used by the rebalancer is pushed by an authorized reporter (a keeper
///         reading Morpho's API/IRMs off-chain) and expires after
///         `aprStaleAfter`. A stale APR reads as 0, so the rebalancer will
///         never move funds *into* Morpho on stale data but can always move
///         funds out. Works with any ERC-4626 venue, not just Morpho.
contract MorphoStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    IERC4626 public immutable morphoVault;

    address public aprReporter;
    uint256 public reportedAPRBps;
    uint256 public lastAPRReportAt;
    uint256 public aprStaleAfter = 1 days;

    event APRReported(uint256 aprBps);
    event APRReporterSet(address indexed reporter);
    event APRStaleAfterSet(uint256 staleAfter);

    error OnlyAPRReporter();
    error VaultAssetMismatch();

    constructor(address vault_, address asset_, address morphoVault_, address aprReporter_)
        BaseStrategy(vault_, asset_)
    {
        if (morphoVault_ == address(0) || aprReporter_ == address(0)) revert ZeroAddress();
        if (IERC4626(morphoVault_).asset() != asset_) revert VaultAssetMismatch();
        morphoVault = IERC4626(morphoVault_);
        aprReporter = aprReporter_;
    }

    function name() external pure override returns (string memory) {
        return "Morpho";
    }

    function totalAssets() public view override returns (uint256) {
        return morphoVault.previewRedeem(morphoVault.balanceOf(address(this)));
    }

    function currentAPRBps() external view override returns (uint256) {
        if (block.timestamp > lastAPRReportAt + aprStaleAfter) return 0;
        return reportedAPRBps;
    }

    function reportAPR(uint256 aprBps) external {
        if (msg.sender != aprReporter) revert OnlyAPRReporter();
        reportedAPRBps = aprBps;
        lastAPRReportAt = block.timestamp;
        emit APRReported(aprBps);
    }

    function setAPRReporter(address reporter) external {
        if (msg.sender != aprReporter) revert OnlyAPRReporter();
        if (reporter == address(0)) revert ZeroAddress();
        aprReporter = reporter;
        emit APRReporterSet(reporter);
    }

    function deposit(uint256 amount) external override onlyVault {
        IERC20(asset).forceApprove(address(morphoVault), amount);
        morphoVault.deposit(amount, address(this));
    }

    function withdraw(uint256 amount, address to) public override onlyVault returns (uint256) {
        morphoVault.withdraw(amount, to, address(this));
        return amount;
    }

    function withdrawAll(address to) external override onlyVault returns (uint256) {
        uint256 shares = morphoVault.balanceOf(address(this));
        if (shares == 0) return 0;
        return morphoVault.redeem(shares, to, address(this));
    }
}
