// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMintable} from "./IMintable.sol";

/// @dev Compound v3 (Comet) market simulator for the base-asset supply side.
///      Linear interest at a settable APR; interest minted from the mock asset.
///      Test/demo only.
contract MockComet {
    using SafeERC20 for IERC20;

    address public immutable baseToken;
    uint256 public aprBps;

    uint256 private constant SECONDS_PER_YEAR = 365 days;

    mapping(address => uint256) private _principal;
    mapping(address => uint256) private _lastAccrualAt;

    error WrongAsset();
    error InsufficientBalance();

    constructor(address baseToken_) {
        baseToken = baseToken_;
    }

    function setAPRBps(uint256 bps) external {
        aprBps = bps;
    }

    function balanceOf(address user) public view returns (uint256) {
        uint256 principal = _principal[user];
        if (principal == 0) return 0;
        uint256 elapsed = block.timestamp - _lastAccrualAt[user];
        return principal + (principal * aprBps * elapsed) / (10_000 * SECONDS_PER_YEAR);
    }

    function _accrue(address user) internal {
        uint256 accruedBalance = balanceOf(user);
        uint256 interest = accruedBalance - _principal[user];
        if (interest > 0) {
            _principal[user] = accruedBalance;
            IMintable(baseToken).mint(address(this), interest);
        }
        _lastAccrualAt[user] = block.timestamp;
    }

    function getUtilization() external pure returns (uint256) {
        return 5e17; // fixed 50% — value irrelevant for the mock rate
    }

    function getSupplyRate(uint256) external view returns (uint64) {
        // annual bps -> per-second rate scaled 1e18 (floor: strategies may
        // read back aprBps - 1; tests tolerate this)
        return uint64((aprBps * 1e14) / SECONDS_PER_YEAR);
    }

    function supply(address asset_, uint256 amount) external {
        if (asset_ != baseToken) revert WrongAsset();
        _accrue(msg.sender);
        IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        _principal[msg.sender] += amount;
    }

    function withdrawTo(address to, address asset_, uint256 amount) external {
        if (asset_ != baseToken) revert WrongAsset();
        _accrue(msg.sender);
        uint256 balance = _principal[msg.sender];
        if (amount > balance) revert InsufficientBalance();
        _principal[msg.sender] = balance - amount;
        IERC20(baseToken).safeTransfer(to, amount);
    }
}
