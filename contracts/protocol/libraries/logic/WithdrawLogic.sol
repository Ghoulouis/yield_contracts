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
        require(vault.balanceOf(owner) >= shares, "Insufficient shares");

        if (sender != owner) {
            vault._spendAllowance(owner, sender, shares);
        }

        if (vault.withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }

        uint256 requestedAssets = assets;
        uint256 currentTotalIdle = vault.totalIdle;
        address _asset = vault.asset();

        if (requestedAssets > currentTotalIdle) {
            address[] memory queue = vault.useDefaultQueue ||
                _strategies.length == 0
                ? vault.defaultQueue
                : _strategies;

            uint256 assetsNeeded = requestedAssets - currentTotalIdle;
            uint256 currentTotalDebt = vault.totalDebt;
            uint256 previousBalance = IERC20(_asset).balanceOf(address(this));

            uint256 currentDebt;
            uint256 assetsToWithdraw;
            uint256 maxAssetsCanWithdraw;
            uint256 unrealisedLoss;

            for (uint256 i = 0; i < queue.length; i++) {
                address strategy = queue[i];

                (
                    assetsNeeded,
                    requestedAssets,
                    currentTotalDebt,
                    unrealisedLoss
                ) = _redeemHelper(
                    vault,
                    strategy,
                    assetsNeeded,
                    requestedAssets,
                    currentTotalDebt
                );

                assetsToWithdraw = Math.min(
                    assetsToWithdraw,
                    maxAssetsCanWithdraw
                );

                if (assetsToWithdraw == 0) continue;

                vault._withdrawFromStrategy(strategy, assetsToWithdraw);

                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                uint256 withdrawn = Math.min(
                    postBalance - previousBalance,
                    currentDebt
                );
                uint256 loss = assetsToWithdraw > withdrawn
                    ? assetsToWithdraw - withdrawn
                    : 0;

                currentTotalIdle += (assetsToWithdraw - loss);
                requestedAssets -= loss;
                currentTotalDebt -= assetsToWithdraw;

                uint256 newDebt = currentDebt -
                    (assetsToWithdraw + unrealisedLoss);
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
        vault.totalIdle -= requestedAssets;
        IERC20(_asset).safeTransfer(receiver, requestedAssets);

        emit IVault.Withdrawn(owner, shares, requestedAssets, 0);
        return requestedAssets;
    }

    function _redeemHelper(
        DataTypes.VaultData storage vault,
        address strategy,
        uint256 assetsNeeded,
        uint256 requestedAssets,
        uint256 currentTotalDebt
    ) internal returns (uint256, uint256, uint256, uint256) {
        require(
            vault.strategies[strategy].activation != 0,
            "Inactive strategy"
        );
        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        uint256 assetsToWithdraw = Math.min(assetsNeeded, currentDebt);
        uint256 maxAssetsCanWithdraw = IStrategy(strategy).convertToAssets(
            IStrategy(strategy).maxRedeem(address(this))
        );
        console.log("assetsToWithdraw", assetsToWithdraw);
        console.log("maxAssetsCanWithdraw", maxAssetsCanWithdraw);

        uint256 unrealisedLoss = UnrealisedLossesLogic
            ._assessShareOfUnrealisedLosses(
                strategy,
                currentDebt,
                assetsToWithdraw
            );

        if (unrealisedLoss > 0) {
            if (maxAssetsCanWithdraw < assetsToWithdraw - unrealisedLoss) {
                unrealisedLoss =
                    (unrealisedLoss * maxAssetsCanWithdraw) /
                    (assetsToWithdraw - unrealisedLoss);
                assetsToWithdraw = maxAssetsCanWithdraw + unrealisedLoss;
            }
            assetsToWithdraw -= unrealisedLoss;
            requestedAssets -= unrealisedLoss;
            assetsNeeded -= unrealisedLoss;
            currentTotalDebt -= unrealisedLoss;

            if (maxAssetsCanWithdraw == 0 && unrealisedLoss > 0) {
                vault.strategies[strategy].currentDebt =
                    currentDebt -
                    unrealisedLoss;
                emit IVault.DebtUpdated(
                    strategy,
                    currentDebt,
                    vault.strategies[strategy].currentDebt
                );
            }
        }

        return (
            assetsNeeded,
            requestedAssets,
            currentTotalDebt,
            unrealisedLoss
        );
    }
}
