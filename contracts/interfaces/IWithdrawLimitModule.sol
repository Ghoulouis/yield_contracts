// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWithdrawLimitModule {
    function availableWithdrawLimit(
        address owner,
        uint256 maxLoss,
        address[] calldata strategies
    ) external view returns (uint256);
}
