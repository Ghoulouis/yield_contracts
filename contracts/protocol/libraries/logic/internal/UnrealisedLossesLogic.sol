// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../../../../interfaces/IStrategy.sol";

library UnrealisedLossesLogic {
    function _assessShareOfUnrealisedLosses(
        address strategy,
        uint256 strategyCurrentDebt,
        uint256 assetsNeeded
    ) internal view returns (uint256) {
        uint256 vaultShares = IStrategy(strategy).balanceOf(address(this));
        uint256 strategyAssets = IStrategy(strategy).convertToAssets(
            vaultShares
        );
        if (strategyAssets >= strategyCurrentDebt || strategyCurrentDebt == 0)
            return 0;

        uint256 numerator = assetsNeeded * strategyAssets;
        uint256 usersShareOfLoss = assetsNeeded -
            (numerator / strategyCurrentDebt);
        if (numerator % strategyCurrentDebt != 0) usersShareOfLoss += 1;
        return usersShareOfLoss;
    }
}
