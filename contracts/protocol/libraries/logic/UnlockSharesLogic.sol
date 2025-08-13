// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../types/DataTypes.sol";
import {ERC20Logic} from "./ERC20Logic.sol";
import {Constants} from "../Constants.sol";
library UnlockSharesLogic {
    using ERC20Logic for DataTypes.VaultData;

    function unlockShares(
        DataTypes.VaultData storage vault
    ) external view returns (uint256) {
        if (vault.fullProfitUnlockDate > block.timestamp) {
            return ((vault.profitUnlockingRate *
                (block.timestamp - vault.lastProfitUpdate)) /
                Constants.MAX_BPS_EXTENDED);
        } else {
            if (vault.fullProfitUnlockDate != 0) {
                return vault.balanceOf(vault.addressVault);
            } else {
                return 0;
            }
        }
    }
}
