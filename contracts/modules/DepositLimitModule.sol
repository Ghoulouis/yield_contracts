// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IDepositLimitModule.sol";
import "../interfaces/IVault.sol";

contract DepositLimitModule is IDepositLimitModule {
    address public vault;
    function availableDepositLimit(
        address receiver
    ) external view returns (uint256) {
        uint256 balance = IVault(msg.sender).convertToAssets(
            IVault(msg.sender).balanceOf(receiver)
        );
        uint256 maxDeposit = 10_000_000;
        return maxDeposit - balance;
    }
}
