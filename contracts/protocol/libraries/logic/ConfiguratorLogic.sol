// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../types/DataTypes.sol";
import {ERC4626Logic} from "./ERC4626Logic.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Logic} from "./ERC20Logic.sol";
import {IStrategy} from "../../../interfaces/IStrategy.sol";
import {IVault} from "../../../interfaces/IVault.sol";
import {Constants} from "../Constants.sol";
library ConfiguratorLogic {
    using ERC20Logic for DataTypes.VaultData;

    function ExecuteSetDefaultQueue(
        DataTypes.VaultData storage vault,
        address[] calldata newDefaultQueue
    ) external {
        require(
            newDefaultQueue.length <= Constants.MAX_QUEUE,
            "Queue too long"
        );
        for (uint256 i = 0; i < newDefaultQueue.length; i++) {
            require(
                vault.strategies[newDefaultQueue[i]].activation != 0,
                "Inactive strategy"
            );
        }
        vault.defaultQueue = newDefaultQueue;
        emit IVault.UpdateDefaultQueue(newDefaultQueue);
    }

    function ExecuteSetUseDefaultQueue(
        DataTypes.VaultData storage vault,
        bool useDefaultQueue
    ) external {
        vault.useDefaultQueue = useDefaultQueue;
        emit IVault.UpdateUseDefaultQueue(useDefaultQueue);
    }

    function ExecuteSetAutoAllocate(
        DataTypes.VaultData storage vault,
        bool autoAllocate
    ) external {
        vault.autoAllocate = autoAllocate;
        emit IVault.UpdateAutoAllocate(autoAllocate);
    }

    function ExecuteAddStrategy(
        DataTypes.VaultData storage vault,
        address newStrategy,
        bool addToQueue
    ) external {
        require(
            newStrategy != address(0) && newStrategy != address(this),
            "Invalid strategy"
        );
        require(
            IStrategy(newStrategy).asset() == vault.asset(),
            "Invalid asset"
        );
        require(
            vault.strategies[newStrategy].activation == 0,
            "Strategy already active"
        );

        vault.strategies[newStrategy] = DataTypes.StrategyData({
            activation: block.timestamp,
            lastReport: block.timestamp,
            currentDebt: 0,
            maxDebt: 0
        });

        if (addToQueue && vault.defaultQueue.length < Constants.MAX_QUEUE) {
            vault.defaultQueue.push(newStrategy);
        }

        emit IVault.StrategyChanged(
            newStrategy,
            IVault.StrategyChangeType.ADDED
        );
    }

    function ExecuteRevokeStrategy(
        DataTypes.VaultData storage vault,
        address strategy,
        bool force
    ) external {
        require(
            vault.strategies[strategy].activation != 0,
            "Strategy not active"
        );

        if (vault.strategies[strategy].currentDebt != 0) {
            require(force, "Strategy has debt");
            uint256 loss = vault.strategies[strategy].currentDebt;
            vault.totalDebt -= loss;
            emit IVault.StrategyReported(strategy, 0, loss, 0, 0, 0, 0);
        }

        delete vault.strategies[strategy];

        address[] memory newQueue = new address[](Constants.MAX_QUEUE);
        uint256 index = 0;
        for (uint256 i = 0; i < vault.defaultQueue.length; i++) {
            if (vault.defaultQueue[i] != strategy) {
                newQueue[index] = vault.defaultQueue[i];
                index++;
            }
        }
        assembly ("memory-safe") {
            mstore(newQueue, index)
        }
        //newQueue.length = index;
        vault.defaultQueue = newQueue;

        emit IVault.StrategyChanged(
            strategy,
            IVault.StrategyChangeType.REVOKED
        );
    }
}
