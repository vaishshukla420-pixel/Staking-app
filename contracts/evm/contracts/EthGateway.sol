// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
}

/// @title EthGateway — native-ETH convenience wrapper for the WETH YieldVault
/// @notice Lets users deposit plain ETH (wrapped to WETH under the hood) and
///         withdraw back to ETH. For withdrawals the user must first approve
///         this gateway on the vault's share token.
contract EthGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IWETH public immutable weth;
    IERC4626 public immutable vault;

    event DepositedETH(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);
    event WithdrewETH(address indexed owner, address indexed receiver, uint256 assets, uint256 shares);

    error VaultAssetNotWETH();
    error ZeroAmount();
    error EthTransferFailed();
    error NotWETH();

    constructor(address weth_, address vault_) {
        weth = IWETH(weth_);
        vault = IERC4626(vault_);
        if (vault.asset() != weth_) revert VaultAssetNotWETH();
        // The gateway never holds funds between transactions, so a standing
        // max approval to the vault is safe.
        weth.approve(vault_, type(uint256).max);
    }

    function depositETH(address receiver) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        weth.deposit{value: msg.value}();
        shares = vault.deposit(msg.value, receiver);
        emit DepositedETH(msg.sender, receiver, msg.value, shares);
    }

    /// @notice Withdraw `assets` of ETH by burning msg.sender's vault shares.
    /// @dev Requires prior share-token approval: vault.approve(gateway, ...)
    function withdrawETH(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        shares = vault.withdraw(assets, address(this), msg.sender);
        _sendETH(receiver, assets);
        emit WithdrewETH(msg.sender, receiver, assets, shares);
    }

    /// @notice Redeem `shares` of msg.sender's vault shares for ETH.
    function redeemETH(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        assets = vault.redeem(shares, address(this), msg.sender);
        _sendETH(receiver, assets);
        emit WithdrewETH(msg.sender, receiver, assets, shares);
    }

    function _sendETH(address to, uint256 assets) internal {
        weth.withdraw(assets);
        (bool ok, ) = to.call{value: assets}("");
        if (!ok) revert EthTransferFailed();
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert NotWETH();
    }
}
