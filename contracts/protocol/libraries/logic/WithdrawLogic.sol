// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DataTypes} from "../types/DataTypes.sol";
import {Constants} from "../Constants.sol";
import {ERC20Logic} from "./ERC20Logic.sol";
import {ERC4626Logic} from "./ERC4626Logic.sol";
import {WithdrawFromStrategyLogic} from "./internal/WithdrawFromStrategyLogic.sol";
import {UnrealisedLossesLogic} from "./internal/UnrealisedLossesLogic.sol";
import {IWithdrawLimitModule} from "../../../interfaces/IWithdrawLimitModule.sol";
import {IStrategy} from "../../../interfaces/IStrategy.sol";
import {IVault} from "../../../interfaces/IVault.sol";

import "hardhat/console.sol";

library WithdrawLogic {
    using Math for uint256;
    using SafeERC20 for IERC20;
    using ERC4626Logic for DataTypes.VaultData;
    using ERC20Logic for DataTypes.VaultData;
    using WithdrawFromStrategyLogic for DataTypes.VaultData;

    function executeRedeem(
        DataTypes.VaultData storage vault,
        address sender,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares,
        uint256 maxLoss,
        address[] memory _strategies
    ) external returns (uint256) {
        return
            _redeem(
                vault,
                sender,
                receiver,
                owner,
                assets,
                shares,
                maxLoss,
                _strategies
            );
    }

    function _redeem(
        DataTypes.VaultData storage vault,
        address sender,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares,
        uint256 maxLoss,
        address[] memory _strategies
    ) internal returns (uint256) {
        // require(!paused(), "Vault paused"); // todo check pause
        require(receiver != address(0), "Zero address");
        require(shares > 0, "No shares to redeem");
        require(assets > 0, "No assets to redeem");
        require(maxLoss <= Constants.MAX_BPS, "Invalid max loss");

        if (vault.withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }

        require(vault.balanceOf(owner) >= shares, "Insufficient shares");

        if (sender != owner) {
            vault._spendAllowance(owner, sender, shares);
        }

        uint256 requestedAssets = assets;
        uint256 currentTotalIdle = vault.totalIdle;
        address _asset = vault.asset();

        if (requestedAssets > currentTotalIdle) {
            address[] memory queue = vault.useDefaultQueue ||
                _strategies.length == 0
                ? vault.defaultQueue
                : _strategies;
            uint256 currentTotalDebt = vault.totalDebt;
            uint256 assetsNeeded = requestedAssets - currentTotalIdle;
            uint256 assetsToWithdraw = 0;
            uint256 previousBalance = IERC20(_asset).balanceOf(address(this));

            for (uint256 i = 0; i < queue.length; i++) {
                address strategy = queue[i];
                require(
                    vault.strategies[strategy].activation != 0,
                    "Inactive strategy"
                );
                uint256 currentDebt = vault.strategies[strategy].currentDebt;
                assetsToWithdraw = Math.min(assetsNeeded, currentDebt);
                uint256 maxWithdraw = IStrategy(strategy).convertToAssets(
                    IStrategy(strategy).maxRedeem(address(this))
                );

                uint256 unrealisedLossesShare = UnrealisedLossesLogic
                    ._assessShareOfUnrealisedLosses(
                        strategy,
                        currentDebt,
                        assetsToWithdraw
                    );
                if (unrealisedLossesShare > 0) {
                    if (
                        maxWithdraw < assetsToWithdraw - unrealisedLossesShare
                    ) {
                        unrealisedLossesShare =
                            (unrealisedLossesShare * maxWithdraw) /
                            (assetsToWithdraw - unrealisedLossesShare);
                        assetsToWithdraw = maxWithdraw + unrealisedLossesShare;
                    }
                    assetsToWithdraw -= unrealisedLossesShare;
                    requestedAssets -= unrealisedLossesShare;

                    assetsNeeded -= unrealisedLossesShare;
                    currentTotalDebt -= unrealisedLossesShare;

                    if (maxWithdraw == 0 && unrealisedLossesShare > 0) {
                        vault.strategies[strategy].currentDebt =
                            currentDebt -
                            unrealisedLossesShare;
                        emit IVault.DebtUpdated(
                            strategy,
                            currentDebt,
                            vault.strategies[strategy].currentDebt
                        );
                    }
                }
                assetsToWithdraw = Math.min(assetsToWithdraw, maxWithdraw);

                if (assetsToWithdraw == 0) continue;

                vault._withdrawFromStrategy(strategy, assetsToWithdraw);

                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                uint256 withdrawn = postBalance - previousBalance;

                uint256 loss = 0;

                if (withdrawn > assetsToWithdraw) {
                    if (withdrawn > currentDebt) {
                        assetsToWithdraw = currentDebt;
                    } else {
                        assetsToWithdraw += withdrawn - assetsToWithdraw;
                    }
                } else if (withdrawn < assetsToWithdraw) {
                    loss = assetsToWithdraw - withdrawn;
                }

                currentTotalIdle += (assetsToWithdraw - loss);
                requestedAssets -= loss;
                currentTotalDebt -= assetsToWithdraw;

                uint256 newDebt = currentDebt -
                    (assetsToWithdraw + unrealisedLossesShare);
                vault.strategies[strategy].currentDebt = newDebt;
                emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
                if (requestedAssets <= currentTotalIdle) break;
                previousBalance = postBalance;
                assetsNeeded -= assetsToWithdraw;
            }

            require(
                currentTotalIdle >= requestedAssets,
                "Insufficient assets to withdraw"
            );
            vault.totalDebt = currentTotalDebt;
        }

        if (assets > requestedAssets && maxLoss < Constants.MAX_BPS) {
            require(
                assets - requestedAssets <=
                    (assets * maxLoss) / Constants.MAX_BPS,
                "Too much loss"
            );
        }

        vault._burn(owner, shares);
        vault.totalIdle = currentTotalIdle - requestedAssets;
        IERC20(_asset).safeTransfer(receiver, requestedAssets);

        emit IVault.Withdrawn(owner, shares, requestedAssets, 0);
        return requestedAssets;
    }
}
