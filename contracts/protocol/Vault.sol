// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IStrategy.sol";
import "../interfaces/IRoleModule.sol";
import "../interfaces/IAccountant.sol";
import "../interfaces/IDepositLimitModule.sol";
import "../interfaces/IWithdrawLimitModule.sol";

import "./logic/ERC4626Logic.sol";

import "./VaultStorage.sol";

contract Vault is
    VaultStorage,
    ERC4626Upgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using ERC4626Logic for ERC4626Upgradeable;

    function maxDeposit(
        address receiver
    ) public view override returns (uint256) {
        return
            ERC4626Logic.maxDeposit(
                address(this),
                receiver,
                depositLimit,
                paused(),
                depositLimitModule
            );
    }

    function maxMint(address user) public view override returns (uint256) {
        return
            ERC4626Logic.maxDeposit(
                address(this),
                user,
                depositLimit,
                paused(),
                depositLimitModule
            );
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return ERC4626Logic.maxWithdraw(address(this), owner);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return ERC4626Logic.MaxRedeem();
    }

    function previewDeposit(
        uint256 assets
    ) public view override returns (uint256) {
        return super.previewDeposit(assets);
    }

    function previewMint(
        uint256 shares
    ) public view override returns (uint256) {
        return super.previewMint(shares);
    }

    function previewWithdraw(
        uint256 assets
    ) public view override returns (uint256) {
        return super.previewWithdraw(assets);
    }

    function previewRedeem(
        uint256 shares
    ) public view override returns (uint256) {
        return super.previewRedeem(shares);
    }

    function deposit(
        uint256 assets,
        address receiver
    ) public override nonReentrant whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(
        uint256 shares,
        address receiver
    ) public override nonReentrant whenNotPaused returns (uint256) {
        return super.mint(shares, receiver);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant whenNotPaused returns (uint256) {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant whenNotPaused returns (uint256) {
        return super.redeem(shares, receiver, owner);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        return super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        return super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _decimalsOffset() internal view override returns (uint8) {
        return super._decimalsOffset();
    }

    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view override returns (uint256) {
        return
            ERC4626Logic._convertToAssets(
                shares,
                totalSupply(),
                totalAssets(),
                rounding
            );
    }
}
