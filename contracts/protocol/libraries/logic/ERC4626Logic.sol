// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVault} from "../../../interfaces/IVault.sol";
import {IStrategy} from "../../../interfaces/IStrategy.sol";
import {IDepositLimitModule} from "../../../interfaces/IDepositLimitModule.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ManagementFeeLogic} from "./internal/ManagementFeeLogic.sol";
import {DataTypes} from "../types/DataTypes.sol";
import {Constants} from "../Constants.sol";
import {ERC20Logic} from "./ERC20Logic.sol";
import {UnrealisedLossesLogic} from "./internal/UnrealisedLossesLogic.sol";
import {IWithdrawLimitModule} from "../../../interfaces/IWithdrawLimitModule.sol";

library ERC4626Logic {
    using Math for uint256;
    using ERC20Logic for DataTypes.VaultData;
    using ERC4626Logic for DataTypes.VaultData;

    function maxDeposit(
        DataTypes.VaultData storage vault,
        address receiver
    ) internal view returns (uint256) {
        if (receiver == address(0) || receiver == address(this)) return 0;
        if (vault.depositLimitModule != address(0)) {
            return
                IDepositLimitModule(vault.depositLimitModule)
                    .availableDepositLimit(receiver);
        }
        if (vault.depositLimit == type(uint256).max) return vault.depositLimit;
        uint256 totalAssets_ = vault.totalAssets();
        if (totalAssets_ >= vault.depositLimit) return 0;
        return vault.depositLimit - totalAssets_;
    }

    function maxMint(
        DataTypes.VaultData storage vault,
        address receiver
    ) external view returns (uint256) {
        uint256 maxDepositAmount = vault.maxDeposit(receiver);
        return vault._convertToShares(maxDepositAmount, Math.Rounding.Floor);
    }

    function maxWithdraw(
        DataTypes.VaultData storage vault,
        address owner
    ) external view returns (uint256) {
        return vault._maxWithdraw(owner, 0, new address[](0));
    }

    function maxWithdraw(
        DataTypes.VaultData storage vault,
        address owner,
        uint256 maxLoss,
        address[] memory strategies
    ) external view returns (uint256) {
        return vault._maxWithdraw(owner, maxLoss, strategies);
    }

    function maxRedeem(
        DataTypes.VaultData storage vault,
        address owner
    ) external view returns (uint256) {
        uint256 maxWithdrawAmount = vault._maxWithdraw(
            owner,
            0,
            new address[](0)
        );
        uint256 shares = vault._convertToShares(
            maxWithdrawAmount,
            Math.Rounding.Floor
        );
        return Math.min(shares, vault.balanceOf(owner));
    }

    function _maxWithdraw(
        DataTypes.VaultData storage vault,
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) internal view returns (uint256) {
        require(maxLoss <= Constants.MAX_BPS, "Invalid max loss");
        uint256 maxAssets = vault._convertToAssets(
            vault.balanceOf(owner),
            Math.Rounding.Floor
        );

        if (vault.withdrawLimitModule != address(0)) {
            return
                Math.min(
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                    maxAssets
                );
        }

        if (maxAssets <= vault.totalIdle) return maxAssets;
        uint256 have = vault.totalIdle;
        uint256 loss = 0;
        address[] memory queue = vault.useDefaultQueue ||
            _strategies.length == 0
            ? vault.defaultQueue
            : _strategies;

        for (uint256 i = 0; i < queue.length; i++) {
            address strategy = queue[i];
            require(
                vault.strategies[strategy].activation != 0,
                "Inactive strategy"
            );

            uint256 currentDebt = vault.strategies[strategy].currentDebt;

            uint256 toWithdraw = Math.min(maxAssets - have, currentDebt);
            if (toWithdraw == 0) continue;

            uint256 unrealisedLoss = UnrealisedLossesLogic
                ._assessShareOfUnrealisedLosses(
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

            if (unrealisedLoss > 0 && maxLoss < Constants.MAX_BPS) {
                if (
                    loss + unrealisedLoss >
                    ((have + toWithdraw) * maxLoss) / Constants.MAX_BPS
                ) break;
            }
            have += toWithdraw;
            loss += unrealisedLoss;
            if (have >= maxAssets) break;
        }
        return have;
    }

    function previewDeposit(
        DataTypes.VaultData storage vault,
        uint256 assets
    ) external view returns (uint256) {
        return _convertToSharesWithFee(vault, assets, Math.Rounding.Floor);
    }

    function previewMint(
        DataTypes.VaultData storage vault,
        uint256 shares
    ) external view returns (uint256) {
        return _convertToAssetsWithFee(vault, shares, Math.Rounding.Ceil);
    }

    function previewWithdraw(
        DataTypes.VaultData storage vault,
        uint256 assets
    ) external view returns (uint256) {
        return _convertToSharesWithFee(vault, assets, Math.Rounding.Ceil);
    }

    function previewRedeem(
        DataTypes.VaultData storage vault,
        uint256 shares
    ) external view returns (uint256) {
        return _convertToAssetsWithFee(vault, shares, Math.Rounding.Floor);
    }

    function convertToAssets(
        DataTypes.VaultData storage vault,
        uint256 shares
    ) external view returns (uint256) {
        return vault._convertToAssets(shares, Math.Rounding.Floor);
    }

    function convertToAssets(
        DataTypes.VaultData storage vault,
        uint256 shares,
        Math.Rounding rounding
    ) external view returns (uint256) {
        return vault._convertToAssets(shares, rounding);
    }

    function convertToAssetsWithFee(
        DataTypes.VaultData storage vault,
        uint256 shares
    ) external view returns (uint256) {
        return vault._convertToAssetsWithFee(shares, Math.Rounding.Floor);
    }

    function convertToAssetsWithFee(
        DataTypes.VaultData storage vault,
        uint256 shares,
        Math.Rounding rounding
    ) external view returns (uint256) {
        return vault._convertToAssetsWithFee(shares, rounding);
    }

    function convertToShares(
        DataTypes.VaultData storage vault,
        uint256 assets
    ) external view returns (uint256) {
        return vault._convertToShares(assets, Math.Rounding.Floor);
    }

    function convertToShares(
        DataTypes.VaultData storage vault,
        uint256 assets,
        Math.Rounding rounding
    ) external view returns (uint256) {
        return vault._convertToShares(assets, rounding);
    }

    function convertToSharesWithFee(
        DataTypes.VaultData storage vault,
        uint256 assets
    ) external view returns (uint256) {
        return vault._convertToSharesWithFee(assets, Math.Rounding.Floor);
    }

    function convertToSharesWithFee(
        DataTypes.VaultData storage vault,
        uint256 assets,
        Math.Rounding rounding
    ) external view returns (uint256) {
        return vault._convertToSharesWithFee(assets, rounding);
    }

    function _convertToAssets(
        DataTypes.VaultData storage vault,
        uint256 shares,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        if (shares == type(uint256).max || shares == 0) {
            return shares;
        }

        uint256 totalSupply = vault.totalSupply();
        uint256 totalAssets = vault.totalAssets();

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

    function _convertToAssetsWithFee(
        DataTypes.VaultData storage vault,
        uint256 shares,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        if (shares == type(uint256).max || shares == 0) {
            return shares;
        }

        uint256 totalSupply = vault.totalSupplyWithFee();
        uint256 totalAssets = vault.totalAssets();

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

    function _convertToSharesWithFee(
        DataTypes.VaultData storage vault,
        uint256 assets,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        if (assets == type(uint256).max || assets == 0) {
            return assets;
        }

        uint256 totalSupply = vault.totalSupplyWithFee();
        uint256 totalAssets = vault.totalAssets();

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

    function _convertToShares(
        DataTypes.VaultData storage vault,
        uint256 assets,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        if (assets == type(uint256).max || assets == 0) {
            return assets;
        }

        uint256 totalSupply = vault.totalSupply();
        uint256 totalAssets = vault.totalAssets();

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

    function pricePerShare(
        DataTypes.VaultData storage vault
    ) external view returns (uint256) {
        return
            vault._convertToAssets(10 ** vault.decimals(), Math.Rounding.Floor);
    }

    function pricePerShareWithFee(
        DataTypes.VaultData storage vault
    ) external view returns (uint256) {
        return
            vault._convertToAssetsWithFee(
                10 ** vault.decimals(),
                Math.Rounding.Floor
            );
    }

    function totalSupplyWithFee(
        DataTypes.VaultData storage vault
    ) internal view returns (uint256) {
        return
            vault.totalSupply() +
            ManagementFeeLogic.viewCalculateManagementFee(vault);
    }
}
