// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../types/DataTypes.sol";
import {ERC4626Logic} from "./ERC4626Logic.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Logic} from "./ERC20Logic.sol";

import {IVault} from "../../../interfaces/IVault.sol";
import "hardhat/console.sol";

library DepositLogic {
    using SafeERC20 for IERC20;
    using ERC4626Logic for DataTypes.VaultData;
    using ERC20Logic for DataTypes.VaultData;

    function executeDeposit(
        DataTypes.VaultData storage vault,
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) external {
        require(assets <= vault.maxDeposit(receiver), "Exceed deposit limit");
        require(shares > 0, "Cannot mint zero");

        IERC20(vault.asset()).safeTransferFrom(
            caller,
            vault.addressVault,
            assets
        );
        vault.totalIdle += assets;
        vault._mint(receiver, shares);

        // if (vaultData.autoAllocate && vaultData.defaultQueue.length > 0) {
        //     _updateDebt(
        //         vaultData,
        //         vaultData.defaultQueue[0],
        //         type(uint256).max,
        //         0
        //     );
        // }

        emit IVault.Deposited(receiver, assets, shares);
    }
}
