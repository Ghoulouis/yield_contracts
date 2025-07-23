// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
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

import "./VaultStorage.sol";

import {Constants} from "./libraries/Constants.sol";
import {DataTypes} from "./libraries/types/DataTypes.sol";
import {ERC20Logic} from "./libraries/logic/ERC20Logic.sol";
import {ERC4626Logic} from "./libraries/logic/ERC4626Logic.sol";

import {InitializeLogic} from "./libraries/logic/InitializeLogic.sol";
import {DepositLogic} from "./libraries/logic/DepositLogic.sol";
import {WithdrawLogic} from "./libraries/logic/WithdrawLogic.sol";
import {UnlockSharesLogic} from "./libraries/logic/UnlockSharesLogic.sol";
import {DebtLogic} from "./libraries/logic/DebtLogic.sol";

import {ConfiguratorLogic} from "./libraries/logic/ConfiguratorLogic.sol";

import {IVault} from "../interfaces/IVault.sol";

import "hardhat/console.sol";

contract Vault is
    IVault,
    VaultStorage,
    ERC4626Upgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable
{
    using ERC4626Logic for DataTypes.VaultData;
    using InitializeLogic for DataTypes.VaultData;
    using DepositLogic for DataTypes.VaultData;
    using WithdrawLogic for DataTypes.VaultData;

    modifier OnlyVault() {
        require(msg.sender == address(this), "Only vault can mint");
        _;
    }

    function initialize(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        uint256 _profitMaxUnlockTime,
        address governance
    ) public initializer {
        __ERC20_init(_name, _symbol);
        __ERC4626_init(_asset);
        __ReentrancyGuard_init();
        __Pausable_init();
        __AccessControl_init();
        vaultData.initialize(_profitMaxUnlockTime);

        _setRoleAdmin(
            Constants.ROLE_ADD_STRATEGY_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_REVOKE_STRATEGY_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_ACCOUNTANT_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_REPORTING_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_DEBT_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_MAX_DEBT_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_DEPOSIT_LIMIT_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _grantRole(Constants.ROLE_GOVERNANCE_MANAGER, governance);
    }

    // ERC20 overrides

    function asset()
        public
        view
        override(ERC4626Upgradeable, IVault)
        returns (address)
    {
        return super.asset();
    }

    function decimals()
        public
        view
        override(ERC4626Upgradeable, IVault)
        returns (uint8)
    {
        return super.decimals();
    }

    function totalSupply()
        public
        view
        override(IERC20, ERC20Upgradeable)
        returns (uint256)
    {
        return super.totalSupply() - UnlockSharesLogic.unlockShares(vaultData);
    }

    function totalAssets()
        public
        view
        override(IERC4626, ERC4626Upgradeable)
        returns (uint256)
    {
        return vaultData.totalIdle + vaultData.totalDebt;
    }

    function maxDeposit(
        address receiver
    ) public view override(ERC4626Upgradeable, IVault) returns (uint256) {
        return vaultData.maxDeposit(receiver);
    }

    function maxMint(
        address user
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return vaultData.maxDeposit(user);
    }

    function maxWithdraw(
        address owner
    ) public view override(ERC4626Upgradeable, IVault) returns (uint256) {
        return vaultData.maxWithdraw(owner);
    }

    function maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) public view returns (uint256) {
        return vaultData.maxWithdraw(owner, maxLoss, _strategies);
    }

    function maxRedeem(
        address owner
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return vaultData.maxRedeem(owner);
    }

    function previewDeposit(
        uint256 assets
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return super.previewDeposit(assets);
    }

    function previewMint(
        uint256 shares
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return super.previewMint(shares);
    }

    function previewWithdraw(
        uint256 assets
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return super.previewWithdraw(assets);
    }

    function previewRedeem(
        uint256 shares
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return super.previewRedeem(shares);
    }

    function deposit(
        uint256 assets,
        address receiver
    )
        public
        override(ERC4626Upgradeable, IVault)
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    function mint(
        uint256 shares,
        address receiver
    )
        public
        override(ERC4626Upgradeable, IERC4626)
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        DepositLogic.executeDeposit(
            vaultData,
            caller,
            receiver,
            assets,
            shares
        );
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        uint256 assets = vaultData._convertToAssets(
            shares,
            Math.Rounding.Floor
        );

        return
            WithdrawLogic.executeRedeem(
                vaultData,
                _msgSender(),
                receiver,
                owner,
                assets,
                shares,
                0,
                new address[](0)
            );
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override(ERC4626Upgradeable, IVault) returns (uint256) {
        uint256 shares = _convertToShares(assets, Math.Rounding.Ceil);
        return
            WithdrawLogic.executeRedeem(
                vaultData,
                _msgSender(),
                receiver,
                owner,
                assets,
                shares,
                0,
                new address[](0)
            );
    }

    function convertToAssets(
        uint256 shares
    ) public view override(IERC4626, ERC4626Upgradeable) returns (uint256) {
        return vaultData.convertToAssets(shares);
    }

    function convertToShares(
        uint256 assets
    ) public view override(IERC4626, ERC4626Upgradeable) returns (uint256) {
        return vaultData.convertToShares(assets);
    }

    // ERC20

    function mint(address receiver, uint256 amount) external OnlyVault {
        _mint(receiver, amount);
    }

    function burn(address owner, uint256 amount) external OnlyVault {
        _burn(owner, amount);
    }

    function spendAllowance(
        address owner,
        address spender,
        uint256 value
    ) external OnlyVault {
        _spendAllowance(owner, spender, value);
    }

    // DEBT MANAGEMENT

    function processReport(address strategy) external nonReentrant {
        DebtLogic.ExecuteProcessReport(vaultData, strategy);
    }

    function updateDebt(
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) external nonReentrant {
        DebtLogic.ExecuteUpdateDebt(vaultData, strategy, targetDebt, maxLoss);
    }

    function updateMaxDebtForStrategy(
        address strategy,
        uint256 newMaxDebt
    ) external nonReentrant {
        DebtLogic.ExecuteUpdateMaxDebtForStrategy(
            vaultData,
            strategy,
            newMaxDebt
        );
    }

    function buyDebt(address strategy, uint256 amount) external {
        DebtLogic.buyDebt(vaultData, strategy, amount);
    }

    // CONFIGURATOR MANAGEMENT

    function addStrategy(
        address strategy,
        bool addToQueue
    ) external nonReentrant {
        ConfiguratorLogic.ExecuteAddStrategy(vaultData, strategy, addToQueue);
    }

    function revokeStrategy(address strategy) external {
        ConfiguratorLogic.ExecuteRevokeStrategy(vaultData, strategy, false);
    }

    function forceRevokeStrategy(address strategy) external {
        ConfiguratorLogic.ExecuteRevokeStrategy(vaultData, strategy, true);
    }

    function setDefaultQueue(
        address[] calldata newDefaultQueue
    ) external nonReentrant {
        ConfiguratorLogic.ExecuteSetDefaultQueue(vaultData, newDefaultQueue);
    }

    function setUseDefaultQueue(bool useDefaultQueue) external {
        ConfiguratorLogic.ExecuteSetUseDefaultQueue(vaultData, useDefaultQueue);
    }

    function setAutoAllocate(bool autoAllocate) public {
        ConfiguratorLogic.ExecuteSetAutoAllocate(vaultData, autoAllocate);
    }

    function setDepositLimit(uint256 depositLimit) external {
        ConfiguratorLogic.ExecuteSetDepositLimit(
            vaultData,
            depositLimit,
            false
        );
    }

    function setDepositLimitForce(uint256 depositLimit) external {
        ConfiguratorLogic.ExecuteSetDepositLimit(vaultData, depositLimit, true);
    }

    function setDepositLimitModule(address newDepositLimitModule) external {
        ConfiguratorLogic.ExecuteSetDepositLimitModule(
            vaultData,
            newDepositLimitModule,
            false
        );
    }

    function setDepositLimitModuleForce(
        address newDepositLimitModule
    ) external {
        ConfiguratorLogic.ExecuteSetDepositLimitModule(
            vaultData,
            newDepositLimitModule,
            true
        );
    }

    function setAccountant(address newAccountant) external {
        ConfiguratorLogic.ExecuteSetAccountant(vaultData, newAccountant);
    }

    // VIEW FUNCTIONS

    function strategies(
        address strategy
    ) public view returns (DataTypes.StrategyData memory) {
        return vaultData.strategies[strategy];
    }

    function pricePerShare() public view returns (uint256) {
        return vaultData.pricePerShare();
    }

    function totalDebt() public view returns (uint256) {
        return vaultData.totalDebt;
    }

    function totalIdle() public view returns (uint256) {
        return vaultData.totalIdle;
    }
}
