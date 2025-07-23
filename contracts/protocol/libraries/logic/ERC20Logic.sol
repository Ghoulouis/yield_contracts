// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVault} from "../../../interfaces/IVault.sol";
import {DataTypes} from "../types/DataTypes.sol";

library ERC20Logic {
    function asset(
        DataTypes.VaultData storage vaultData
    ) internal view returns (address) {
        return IVault(vaultData.addressVault).asset();
    }

    function decimals(
        DataTypes.VaultData storage vaultData
    ) internal view returns (uint8) {
        return IVault(vaultData.addressVault).decimals();
    }

    function totalAssets(
        DataTypes.VaultData storage vaultData
    ) internal view returns (uint256) {
        return IVault(vaultData.addressVault).totalAssets();
    }

    function totalSupply(
        DataTypes.VaultData storage vaultData
    ) internal view returns (uint256) {
        return IVault(vaultData.addressVault).totalSupply();
    }

    function balanceOf(
        DataTypes.VaultData storage vaultData,
        address owner
    ) internal view returns (uint256) {
        return IERC20(vaultData.addressVault).balanceOf(owner);
    }

    function _spendAllowance(
        DataTypes.VaultData storage vaultData,
        address owner,
        address spender,
        uint256 value
    ) internal {
        return
            IVault(vaultData.addressVault).spendAllowance(
                owner,
                spender,
                value
            );
    }

    function _mint(
        DataTypes.VaultData storage vaultData,
        address receiver,
        uint256 assets
    ) internal {
        IVault(vaultData.addressVault).mint(receiver, assets);
    }

    function _burn(
        DataTypes.VaultData storage vaultData,
        address receiver,
        uint256 assets
    ) internal {
        IVault(vaultData.addressVault).burn(receiver, assets);
    }
}
