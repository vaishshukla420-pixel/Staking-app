// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal WETH9-style wrapper for tests/demos, with open mint so mock
///      yield venues can fund accrued interest. NEVER deploy to mainnet.
contract MockWETH is ERC20 {
    error EthTransferFailed();

    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        // Mock venues mint WETH yield without backing ETH, so top up with
        // held ETH only; in tests the gateway path always has backing.
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Accept ETH without minting — lets tests back the WETH that mock
    ///      venues mint as yield, so unwrapping never runs dry.
    function fundETH() external payable {}

    receive() external payable {
        deposit();
    }
}
