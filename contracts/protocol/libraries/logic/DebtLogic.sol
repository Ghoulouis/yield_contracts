// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {DataTypes} from "../types/DataTypes.sol";
import {Constants} from "../Constants.sol";
import {ERC20Logic} from "./ERC20Logic.sol";
import {ERC4626Logic} from "./ERC4626Logic.sol";
import {UnlockSharesLogic} from "./UnlockSharesLogic.sol";
import {WithdrawFromStrategyLogic} from "./internal/WithdrawFromStrategyLogic.sol";
import {UnrealisedLossesLogic} from "./internal/UnrealisedLossesLogic.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVault} from "../../../interfaces/IVault.sol";
import {IStrategy} from "../../../interfaces/IStrategy.sol";
import {IAccountant} from "../../../interfaces/IAccountant.sol";

library DebtLogic {
    using ERC20Logic for DataTypes.VaultData;
    using ERC4626Logic for DataTypes.VaultData;
    using UnlockSharesLogic for DataTypes.VaultData;

    using SafeERC20 for IERC20;

    function ExecuteProcessReport(
        DataTypes.VaultData storage vault,
        address strategy
    ) external returns (uint256 gain, uint256 loss) {
        require(strategy != address(this), "Invalid strategy");
        require(
            vault.strategies[strategy].activation != 0,
            "Inactive strategy"
        );
        address _asset = vault.asset();
        uint256 totalAssets;
        uint256 currentDebt;
        if (strategy != address(this)) {
            require(
                vault.strategies[strategy].activation != 0,
                "Inactive strategy"
            );
            uint256 strategyShares = IStrategy(strategy).balanceOf(
                address(this)
            );
            totalAssets = IStrategy(strategy).convertToAssets(strategyShares);
            currentDebt = vault.strategies[strategy].currentDebt;
        } else {
            totalAssets = IERC20(_asset).balanceOf(address(this));
            currentDebt = vault.totalIdle;
        }
        if (totalAssets > currentDebt) {
            gain = totalAssets - currentDebt;
        } else {
            loss = currentDebt - totalAssets;
        }
        uint256 totalFees;
        uint256 totalRefunds;
        if (vault.accountant != address(0)) {
            (totalFees, totalRefunds) = IAccountant(vault.accountant).report(
                strategy,
                gain,
                loss
            );
            totalRefunds = Math.min(
                totalRefunds,
                Math.min(
                    IERC20(_asset).balanceOf(vault.accountant),
                    IERC20(_asset).allowance(vault.accountant, address(this))
                )
            );
        }
        uint256 totalFeesShares;
        uint256 protocolFeesShares;
        uint256 sharesToBurn;
        if (loss + totalFees > 0) {
            sharesToBurn = vault.convertToShares(loss + totalFees);
            if (totalFees > 0) {
                totalFeesShares =
                    (sharesToBurn * totalFees) /
                    (loss + totalFees);
                // if (vault.protocolFeeBps > 0) {
                //     protocolFeesShares =
                //         (totalFeesShares * vault.protocolFeeBps) /
                //         MAX_BPS;
                // }
            }
        }
        uint256 sharesToLock;
        if (gain + totalRefunds > 0 && vault.profitMaxUnlockTime != 0) {
            sharesToLock = vault.convertToShares(gain + totalRefunds);
        }
        uint256 lockedShares = vault.unlockShares();
        uint256 totalSupply = vault.totalSupply() + lockedShares;
        uint256 endingSupply = totalSupply +
            sharesToLock -
            sharesToBurn -
            lockedShares;
        uint256 totalLockedShares = vault.balanceOf(address(this));
        // mint reward
        if (endingSupply > totalSupply) {
            vault._mint(address(this), endingSupply - totalSupply);
        }
        // burn reward
        if (totalSupply > endingSupply) {
            uint256 toBurn = Math.min(
                totalSupply - endingSupply,
                totalLockedShares
            );
            vault._burn(address(this), toBurn);
        }
        if (sharesToLock > sharesToBurn) {
            sharesToLock -= sharesToBurn;
        } else {
            sharesToLock = 0;
        }
        if (totalRefunds > 0) {
            IERC20(vault.asset()).safeTransferFrom(
                vault.accountant,
                address(this),
                totalRefunds
            );
            vault.totalIdle += totalRefunds;
        }
        if (gain > 0) {
            currentDebt += gain;
            if (strategy != address(this)) {
                vault.strategies[strategy].currentDebt = currentDebt;
                vault.totalDebt += gain;
            } else {
                currentDebt += totalRefunds;
                vault.totalIdle = currentDebt;
            }
        }
        if (loss > 0) {
            currentDebt -= loss;
            if (strategy != address(this)) {
                vault.strategies[strategy].currentDebt = currentDebt;
                vault.totalDebt -= loss;
            } else {
                currentDebt += totalRefunds;
                vault.totalIdle = currentDebt;
            }
        }
        // if (totalFeesShares > 0) {
        //     vault.mint(vault.beneficiary, totalFeesShares - protocolFeesShares);
        //     if (protocolFeesShares > 0) {
        //         vault.mint(vault.protocolFeeRecipient, protocolFeesShares);
        //     }
        // }
        totalLockedShares = vault.balanceOf(address(this));
        if (totalLockedShares > 0) {
            uint256 previouslyLockedTime;
            if (vault.fullProfitUnlockDate > block.timestamp) {
                previouslyLockedTime =
                    (totalLockedShares - sharesToLock) *
                    (vault.fullProfitUnlockDate - block.timestamp);
            }
            uint256 newProfitLockingPeriod = (previouslyLockedTime +
                sharesToLock *
                vault.profitMaxUnlockTime) / totalLockedShares;
            vault.profitUnlockingRate =
                (totalLockedShares * Constants.MAX_BPS_EXTENDED) /
                newProfitLockingPeriod;
            vault.fullProfitUnlockDate =
                block.timestamp +
                newProfitLockingPeriod;
            vault.lastProfitUpdate = block.timestamp;
        } else {
            vault.fullProfitUnlockDate = 0;
        }
        vault.strategies[strategy].lastReport = block.timestamp;
        if (
            loss + totalFees > gain + totalRefunds ||
            vault.profitMaxUnlockTime == 0
        ) {
            totalFees = vault.convertToAssets(totalFeesShares);
        }
        emit IVault.StrategyReported(
            strategy,
            gain,
            loss,
            currentDebt,
            protocolFeesShares,
            totalFees,
            totalRefunds
        );
        return (gain, loss);
    }

    function ExecuteUpdateDebt(
        DataTypes.VaultData storage vault,
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) external returns (uint256) {
        require(
            vault.strategies[strategy].activation != 0,
            "Inactive strategy"
        );

        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        require(targetDebt != currentDebt, "No debt change");

        if (currentDebt > targetDebt) {
            uint256 assetsToWithdraw = currentDebt - targetDebt;
            if (vault.totalIdle + assetsToWithdraw < vault.minimumTotalIdle) {
                assetsToWithdraw = vault.minimumTotalIdle > vault.totalIdle
                    ? vault.minimumTotalIdle - vault.totalIdle
                    : 0;
                assetsToWithdraw = Math.min(assetsToWithdraw, currentDebt);
            }

            uint256 withdrawable = IStrategy(strategy).convertToAssets(
                IStrategy(strategy).maxRedeem(address(this))
            );

            assetsToWithdraw = Math.min(assetsToWithdraw, withdrawable);
            require(
                UnrealisedLossesLogic._assessShareOfUnrealisedLosses(
                    strategy,
                    currentDebt,
                    assetsToWithdraw
                ) == 0,
                "Unrealised losses"
            );

            if (assetsToWithdraw == 0) return currentDebt;

            uint256 preBalance = IERC20(vault.asset()).balanceOf(address(this));
            WithdrawFromStrategyLogic._withdrawFromStrategy(
                vault,
                strategy,
                assetsToWithdraw
            );
            uint256 postBalance = IERC20(vault.asset()).balanceOf(
                address(this)
            );
            uint256 withdrawn = Math.min(postBalance - preBalance, currentDebt);

            if (withdrawn < assetsToWithdraw && maxLoss < Constants.MAX_BPS) {
                require(
                    (assetsToWithdraw - withdrawn) <=
                        (assetsToWithdraw * maxLoss) / Constants.MAX_BPS,
                    "Too much loss"
                );
            } else if (withdrawn > assetsToWithdraw) {
                assetsToWithdraw = withdrawn;
            }

            vault.totalIdle += withdrawn;
            vault.totalDebt -= assetsToWithdraw;
            uint256 newDebt = currentDebt - assetsToWithdraw;

            vault.strategies[strategy].currentDebt = newDebt;
            emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        } else {
            uint256 maxDebt = vault.strategies[strategy].maxDebt;
            uint256 newDebt = Math.min(targetDebt, maxDebt);
            if (newDebt <= currentDebt) return currentDebt;

            uint256 _maxDeposit = IStrategy(strategy).maxDeposit(address(this));
            if (_maxDeposit == 0) return currentDebt;

            uint256 assetsToDeposit = newDebt - currentDebt;
            assetsToDeposit = Math.min(assetsToDeposit, _maxDeposit);
            if (vault.totalIdle <= vault.minimumTotalIdle) return currentDebt;
            assetsToDeposit = Math.min(
                assetsToDeposit,
                vault.totalIdle - vault.minimumTotalIdle
            );

            if (assetsToDeposit > 0) {
                address _asset = vault.asset();
                IERC20(_asset).approve(strategy, assetsToDeposit);
                uint256 preBalance = IERC20(_asset).balanceOf(address(this));

                IStrategy(strategy).deposit(assetsToDeposit, address(this));
                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                IERC20(_asset).approve(strategy, 0);
                assetsToDeposit = preBalance - postBalance;
                vault.totalIdle -= assetsToDeposit;
                vault.totalDebt += assetsToDeposit;
            }

            newDebt = currentDebt + assetsToDeposit;
            vault.strategies[strategy].currentDebt = newDebt;
            emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        }
    }

    function buyDebt(
        DataTypes.VaultData storage vault,
        address strategy,
        uint256 amount
    ) public {
        require(vault.strategies[strategy].activation != 0, "Not active");
        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        require(currentDebt > 0 && amount > 0, "Nothing to buy");

        uint256 _amount = Math.min(amount, currentDebt);
        uint256 shares = (IStrategy(strategy).balanceOf(address(this)) *
            _amount) / currentDebt;

        require(shares > 0, "Cannot buy zero");
        IERC20(vault.asset()).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        vault.strategies[strategy].currentDebt -= _amount;
        vault.totalDebt -= _amount;
        vault.totalIdle += _amount;
        IERC20(strategy).safeTransfer(msg.sender, shares);

        emit IVault.DebtUpdated(
            strategy,
            currentDebt,
            vault.strategies[strategy].currentDebt
        );
        emit IVault.DebtPurchased(strategy, _amount);
    }
}
