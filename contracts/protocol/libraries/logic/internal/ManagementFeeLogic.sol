// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DataTypes} from "../../types/DataTypes.sol";
import {Constants} from "../../Constants.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../../../../interfaces/IStrategy.sol";
import "hardhat/console.sol";
import {ERC20Logic} from "../ERC20Logic.sol";
import {IVault} from "../../../../interfaces/IVault.sol";

library ManagementFeeLogic {
    using ERC20Logic for DataTypes.VaultData;

    function caculateManagementFee(
        DataTypes.VaultData storage vault
    ) internal returns (uint256 feeShares) {
        feeShares = _calculateManagementFee(vault);
        if (vault.feeRecipient != address(0) && feeShares > 0) {
            vault._mint(vault.feeRecipient, feeShares);
        }
        vault.lastTimeTakeManagementFee = block.timestamp;
        emit IVault.ManagementFeeMinted(vault.feeRecipient, feeShares);
    }

    function viewCalculateManagementFee(
        DataTypes.VaultData storage vault
    ) internal view returns (uint256) {
        return _calculateManagementFee(vault);
    }

    function _calculateManagementFee(
        DataTypes.VaultData storage vault
    ) internal view returns (uint256 feeShares) {
        uint256 totalSupply = vault.totalSupply();
        uint256 totalUserSupply = totalSupply -
            vault.balanceOf(vault.addressVault);
        feeShares =
            (totalUserSupply *
                (block.timestamp - vault.lastTimeTakeManagementFee) *
                vault.managementFee) /
            (Constants.YEAR * Constants.MAX_BPS);
    }
}
