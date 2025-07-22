// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {DataTypes} from "../../types/DataTypes.sol";
import {ERC20Logic} from "../ERC20Logic.sol";
import {ERC4626Logic} from "../ERC4626Logic.sol";

import {IVault} from "../../../../interfaces/IVault.sol";
import {IStrategy} from "../../../../interfaces/IStrategy.sol";
import "hardhat/console.sol";

library WithdrawFromStrategyLogic {
    using SafeERC20 for IERC20;
    using ERC4626Logic for DataTypes.VaultData;
    using ERC20Logic for DataTypes.VaultData;

    function _withdrawFromStrategy(
        DataTypes.VaultData storage vault,
        address strategy,
        uint256 assetsToWithdraw
    ) internal {
        uint256 sharesToRedeem = Math.min(
            IStrategy(strategy).previewWithdraw(assetsToWithdraw),
            IStrategy(strategy).balanceOf(address(this))
        );
        IStrategy(strategy).redeem(
            sharesToRedeem,
            address(this),
            address(this)
        );
    }
}
