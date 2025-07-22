// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../types/DataTypes.sol";
import {Constants} from "../Constants.sol";
library InitializeLogic {
    function initialize(
        DataTypes.VaultData storage vault,
        uint256 _profitMaxUnlockTime
    ) external {
        require(
            _profitMaxUnlockTime <= Constants.MAX_PROFIT_UNLOCK_TIME,
            "Profit unlock time too long"
        );
        vault.addressVault = address(this);
        vault.profitMaxUnlockTime = _profitMaxUnlockTime;
        vault.useDefaultQueue = true;
        vault.depositLimit = type(uint256).max;
    }
}
