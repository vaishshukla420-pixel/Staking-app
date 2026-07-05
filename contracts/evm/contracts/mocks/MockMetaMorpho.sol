// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IMintable} from "./IMintable.sol";

/// @dev MetaMorpho-style ERC-4626 yield vault simulator: share price grows
///      with linear interest at a settable APR, funded by minting the mock
///      asset. Test/demo only.
contract MockMetaMorpho is ERC4626 {
    uint256 public aprBps;
    uint256 public lastAccrualAt;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock MetaMorpho Vault", "mmVLT") {
        lastAccrualAt = block.timestamp;
    }

    function setAPRBps(uint256 bps) external {
        accrue();
        aprBps = bps;
    }

    function _pendingYield() internal view returns (uint256) {
        uint256 held = IERC20(asset()).balanceOf(address(this));
        if (held == 0 || aprBps == 0) return 0;
        return (held * aprBps * (block.timestamp - lastAccrualAt)) / (10_000 * 365 days);
    }

    function accrue() public {
        uint256 pending = _pendingYield();
        if (pending > 0) IMintable(asset()).mint(address(this), pending);
        lastAccrualAt = block.timestamp;
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + _pendingYield();
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        accrue();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256) {
        accrue();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        accrue();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        accrue();
        return super.redeem(shares, receiver, owner);
    }
}
