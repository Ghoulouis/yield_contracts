// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAccountant {
    function report(
        address strategy,
        uint256 gain,
        uint256 loss
    ) external returns (uint256 totalFees, uint256 totalRefunds);
}
