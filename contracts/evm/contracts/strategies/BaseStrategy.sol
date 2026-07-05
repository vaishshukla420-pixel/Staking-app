// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";

/// @dev Shared plumbing for venue adapters: immutable vault/asset wiring and
///      the only-vault access check. Strategies hold venue receipt tokens but
///      never own user funds economically — everything is attributed to the vault.
abstract contract BaseStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable override vault;
    address public immutable override asset;

    error OnlyVault();
    error ZeroAddress();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_, address asset_) {
        if (vault_ == address(0) || asset_ == address(0)) revert ZeroAddress();
        vault = vault_;
        asset = asset_;
    }
}
