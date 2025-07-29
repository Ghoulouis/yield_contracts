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
        // strategy
        mapping(address => StrategyData) strategies;
        address[] defaultQueue;
        bool useDefaultQueue;
        bool autoAllocate;
        // limit
        uint256 minimumTotalIdle;
        uint256 depositLimit;
        // profit unlocking
        uint256 profitMaxUnlockTime;
        uint256 fullProfitUnlockDate;
        uint256 profitUnlockingRate;
        uint256 lastProfitUpdate;
        // modules
        address accountant;
        address depositLimitModule;
        address withdrawLimitModule;
        // management fee
        address feeRecipient;
        uint256 managementFee;
        uint256 lastTimeTakeManagementFee;
    }
}
