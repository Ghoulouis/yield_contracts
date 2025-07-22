// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library DataTypes {
    struct StrategyData {
        uint256 activation;
        uint256 lastReport;
        uint256 currentDebt;
        uint256 maxDebt;
    }

    struct VaultData {
        address addressVault;
        uint256 totalDebt;
        uint256 totalIdle;
        mapping(address => StrategyData) strategies;
        address[] defaultQueue;
        bool useDefaultQueue;
        bool autoAllocate;
        uint256 minimumTotalIdle;
        uint256 depositLimit;
        uint256 profitMaxUnlockTime;
        uint256 fullProfitUnlockDate;
        uint256 profitUnlockingRate;
        uint256 lastProfitUpdate;
        address accountant;
        address roleModule;
        address depositLimitModule;
        address withdrawLimitModule;
        uint256 totalPendingWithdraw;
        mapping(address => uint256) pendingWithdraw;
    }
}
