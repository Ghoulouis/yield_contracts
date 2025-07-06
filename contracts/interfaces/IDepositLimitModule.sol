// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDepositLimitModule {
    function availableDepositLimit(
        address receiver
    ) external view returns (uint256);
}
