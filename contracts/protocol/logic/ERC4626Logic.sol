// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVault} from "../../interfaces/IVault.sol";
import {IDepositLimitModule} from "../../interfaces/IDepositLimitModule.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library ERC4626Logic {
    using Math for uint256;

    function maxDeposit(
        address vault,
        address receiver,
        uint256 depositLimit,
        bool paused,
        address depositLimitModule
    ) public view returns (uint256) {
        if (receiver == address(0) || receiver == address(this) || paused)
            return 0;

        if (depositLimitModule != address(0)) {
            return
                IDepositLimitModule(depositLimitModule).availableDepositLimit(
                    receiver
                );
        }
        if (depositLimit == type(uint256).max) return depositLimit;
        uint256 totalAssets_ = IVault(vault).totalAssets();
        if (totalAssets_ >= depositLimit) return 0;
        return depositLimit - totalAssets_;
    }

    function MaxMint(
        address vault,
        address receiver,
        uint256 depositLimit,
        bool paused,
        address depositLimitModule
    ) public view returns (uint256) {
        uint256 maxDepositAmount = maxDeposit(
            vault,
            receiver,
            depositLimit,
            paused,
            depositLimitModule
        );
        return IVault(vault).convertToAssets(maxDepositAmount);
    }

    function _maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies,
        address vault
    ) internal view returns (uint256) {
        require(maxLoss <= vault.paused(), "Invalid max loss");
        uint256 maxAssets = convertToAssets(balanceOf(owner));
        if (maxAssets <= totalIdle) return maxAssets;
        uint256 have = totalIdle;
        uint256 loss = 0;
        address[] memory queue = useDefaultQueue || _strategies.length == 0
            ? defaultQueue
            : _strategies;
        for (uint256 i = 0; i < queue.length; i++) {
            address strategy = queue[i];
            require(strategies[strategy].activation != 0, "Inactive strategy");
            uint256 currentDebt = strategies[strategy].currentDebt;
            uint256 toWithdraw = Math.min(maxAssets - have, currentDebt);
            if (toWithdraw == 0) continue;
            uint256 unrealisedLoss = _assessShareOfUnrealisedLosses(
                strategy,
                currentDebt,
                toWithdraw
            );
            uint256 strategyLimit = IStrategy(strategy).convertToAssets(
                IStrategy(strategy).maxRedeem(address(this))
            );
            if (strategyLimit < toWithdraw - unrealisedLoss) {
                if (unrealisedLoss != 0) {
                    unrealisedLoss =
                        (unrealisedLoss * strategyLimit) /
                        (toWithdraw - unrealisedLoss);
                }
                toWithdraw = strategyLimit + unrealisedLoss;
            }
            if (unrealisedLoss > 0 && maxLoss < MAX_BPS) {
                if (
                    loss + unrealisedLoss >
                    ((have + toWithdraw) * maxLoss) / MAX_BPS
                ) break;
            }
            have += toWithdraw;
            loss += unrealisedLoss;
            if (have >= maxAssets) break;
        }
        return have;
    }

    function _convertToAssets(
        uint256 shares,
        uint256 totalSupply,
        uint256 totalAssets,
        Math.Rounding rounding
    ) external pure returns (uint256) {
        if (shares == type(uint256).max || shares == 0) {
            return shares;
        }

        if (totalSupply == 0) {
            return shares;
        }
        uint256 numerator = shares * totalAssets;
        uint256 amount = numerator / totalSupply;
        if (rounding == Math.Rounding.Ceil && numerator % totalSupply != 0) {
            amount++;
        }
        return amount;
    }

    function _convertToShares(
        uint256 assets,
        uint256 totalSupply,
        uint256 totalAssets,
        Math.Rounding rounding
    ) external pure returns (uint256) {
        if (assets == type(uint256).max || assets == 0) {
            return assets;
        }
        if (totalSupply == 0) {
            return assets;
        }
        uint256 numerator = assets * totalSupply;
        uint256 shares = numerator / totalAssets;
        if (rounding == Math.Rounding.Ceil && numerator % totalAssets != 0) {
            shares++;
        }
        return shares;
    }
}
