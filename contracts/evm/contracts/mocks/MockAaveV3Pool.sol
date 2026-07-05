// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AaveDataTypes} from "../interfaces/aave/IAaveV3Pool.sol";
import {IMintable} from "./IMintable.sol";

/// @dev Single-asset Aave v3 pool simulator. It doubles as its own aToken:
///      `balanceOf` reports supplied principal plus linear interest at a
///      settable APR, and interest is minted from the mock asset on demand.
///      Test/demo only.
contract MockAaveV3Pool {
    using SafeERC20 for IERC20;

    address public immutable asset;
    uint256 public aprBps;

    mapping(address => uint256) private _principal;
    mapping(address => uint256) private _lastAccrualAt;

    error WrongAsset();
    error InsufficientBalance();

    constructor(address asset_) {
        asset = asset_;
    }

    function setAPRBps(uint256 bps) external {
        aprBps = bps;
    }

    // --- aToken view ---

    function balanceOf(address user) public view returns (uint256) {
        return _principal[user] + _pendingInterest(user);
    }

    function _pendingInterest(address user) internal view returns (uint256) {
        uint256 principal = _principal[user];
        if (principal == 0) return 0;
        uint256 elapsed = block.timestamp - _lastAccrualAt[user];
        return (principal * aprBps * elapsed) / (10_000 * 365 days);
    }

    function _accrue(address user) internal {
        uint256 interest = _pendingInterest(user);
        if (interest > 0) {
            _principal[user] += interest;
            IMintable(asset).mint(address(this), interest);
        }
        _lastAccrualAt[user] = block.timestamp;
    }

    // --- IAaveV3Pool ---

    function supply(address asset_, uint256 amount, address onBehalfOf, uint16) external {
        if (asset_ != asset) revert WrongAsset();
        _accrue(onBehalfOf);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _principal[onBehalfOf] += amount;
    }

    function withdraw(address asset_, uint256 amount, address to) external returns (uint256) {
        if (asset_ != asset) revert WrongAsset();
        _accrue(msg.sender);
        uint256 balance = _principal[msg.sender];
        if (amount == type(uint256).max) amount = balance;
        if (amount > balance) revert InsufficientBalance();
        _principal[msg.sender] = balance - amount;
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }

    function getReserveData(address) external view returns (AaveDataTypes.ReserveData memory data) {
        data.currentLiquidityRate = uint128(aprBps * 1e23); // bps -> ray
        data.aTokenAddress = address(this);
        data.lastUpdateTimestamp = uint40(block.timestamp);
    }
}
