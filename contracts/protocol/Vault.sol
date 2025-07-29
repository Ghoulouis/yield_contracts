// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IStrategy.sol";
import "../interfaces/IRoleModule.sol";
import "../interfaces/IAccountant.sol";
import "../interfaces/IDepositLimitModule.sol";
import "../interfaces/IWithdrawLimitModule.sol";

import "./VaultStorage.sol";
import {DataTypes} from "./libraries/types/DataTypes.sol";
import {Constants} from "./libraries/Constants.sol";
import {ERC20Logic} from "./libraries/logic/ERC20Logic.sol";
import {ERC4626Logic} from "./libraries/logic/ERC4626Logic.sol";
import {InitializeLogic} from "./libraries/logic/InitializeLogic.sol";
import {DepositLogic} from "./libraries/logic/DepositLogic.sol";
import {WithdrawLogic} from "./libraries/logic/WithdrawLogic.sol";
import {UnlockSharesLogic} from "./libraries/logic/UnlockSharesLogic.sol";
import {DebtLogic} from "./libraries/logic/DebtLogic.sol";
import {ConfiguratorLogic} from "./libraries/logic/ConfiguratorLogic.sol";
import {ManagementFeeLogic} from "./libraries/logic/internal/ManagementFeeLogic.sol";
import {IVault} from "../interfaces/IVault.sol";

contract Vault is
    IVault,
    VaultStorage,
    ERC4626Upgradeable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable
{
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
        __AccessControl_init();

        InitializeLogic.ExecuteInitialize(vaultData, _profitMaxUnlockTime);

        _grantRole(Constants.ROLE_GOVERNANCE_MANAGER, governance);

        _setRoleAdmin(
            Constants.ROLE_GOVERNANCE_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
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
            Constants.ROLE_QUEUE_MANAGER,
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
        _setRoleAdmin(
            Constants.ROLE_WITHDRAW_LIMIT_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_MINIMUM_IDLE_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_PROFIT_UNLOCK_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_DEBT_PURCHASER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
        _setRoleAdmin(
            Constants.ROLE_EMERGENCY_MANAGER,
            Constants.ROLE_GOVERNANCE_MANAGER
        );
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

    // ERC4626 overrides

    function totalSupply()
        public
        view
        override(IERC20, ERC20Upgradeable)
        returns (uint256)
    {
        return super.totalSupply() - UnlockSharesLogic.unlockShares(vaultData);
    }

    function totalSupplyWithFee() public view returns (uint256) {
        return
            totalSupply() +
            ManagementFeeLogic.viewCalculateManagementFee(vaultData);
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
        return ERC4626Logic.maxDeposit(vaultData, receiver);
    }

    function maxMint(
        address user
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.maxDeposit(vaultData, user);
    }

    function maxWithdraw(
        address owner
    ) public view override(ERC4626Upgradeable, IVault) returns (uint256) {
        return ERC4626Logic.maxWithdraw(vaultData, owner);
    }

    function maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) public view override returns (uint256) {
        return ERC4626Logic.maxWithdraw(vaultData, owner, maxLoss, _strategies);
    }

    function maxRedeem(
        address owner
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.maxRedeem(vaultData, owner);
    }

    function previewDeposit(
        uint256 assets
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.previewDeposit(vaultData, assets);
    }

    function previewMint(
        uint256 shares
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.previewMint(vaultData, shares);
    }

    function previewWithdraw(
        uint256 assets
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.previewWithdraw(vaultData, assets);
    }

    function previewRedeem(
        uint256 shares
    ) public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return ERC4626Logic.previewRedeem(vaultData, shares);
    }

    function deposit(
        uint256 assets,
        address receiver
    )
        public
        override(ERC4626Upgradeable, IVault)
        nonReentrant
        returns (uint256)
    {
        ManagementFeeLogic.caculateManagementFee(vaultData);
        return super.deposit(assets, receiver);
    }

    function mint(
        uint256 shares,
        address receiver
    )
        public
        override(ERC4626Upgradeable, IERC4626)
        nonReentrant
        returns (uint256)
    {
        ManagementFeeLogic.caculateManagementFee(vaultData);
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
        ManagementFeeLogic.caculateManagementFee(vaultData);
        uint256 assets = ERC4626Logic.convertToAssets(
            vaultData,
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
        ManagementFeeLogic.caculateManagementFee(vaultData);
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
        return ERC4626Logic.convertToAssets(vaultData, shares);
    }

    function convertToShares(
        uint256 assets
    ) public view override(IERC4626, ERC4626Upgradeable) returns (uint256) {
        return ERC4626Logic.convertToShares(vaultData, assets);
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

    function processReport(
        address strategy
    ) external nonReentrant onlyRole(Constants.ROLE_REPORTING_MANAGER) {
        DebtLogic.ExecuteProcessReport(vaultData, strategy);
    }

    function updateDebt(
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) external nonReentrant onlyRole(Constants.ROLE_DEBT_MANAGER) {
        DebtLogic.ExecuteUpdateDebt(vaultData, strategy, targetDebt, maxLoss);
    }

    function updateMaxDebtForStrategy(
        address strategy,
        uint256 newMaxDebt
    ) external nonReentrant onlyRole(Constants.ROLE_MAX_DEBT_MANAGER) {
        DebtLogic.ExecuteUpdateMaxDebtForStrategy(
            vaultData,
            strategy,
            newMaxDebt
        );
    }

    function buyDebt(
        address strategy,
        uint256 amount
    ) external nonReentrant onlyRole(Constants.ROLE_DEBT_PURCHASER) {
        DebtLogic.buyDebt(vaultData, strategy, amount);
    }

    // CONFIGURATOR MANAGEMENT

    function addStrategy(
        address strategy,
        bool addToQueue
    ) external nonReentrant onlyRole(Constants.ROLE_ADD_STRATEGY_MANAGER) {
        ConfiguratorLogic.ExecuteAddStrategy(vaultData, strategy, addToQueue);
    }

    function revokeStrategy(address strategy) external onlyRole(Constants.ROLE_REVOKE_STRATEGY_MANAGER)  {
        ConfiguratorLogic.ExecuteRevokeStrategy(vaultData, strategy, false);
    }

    function forceRevokeStrategy(address strategy) external onlyRole(Constants.ROLE_REVOKE_STRATEGY_MANAGER)  {
        ConfiguratorLogic.ExecuteRevokeStrategy(vaultData, strategy, true);
    }

    function setDefaultQueue(
        address[] calldata newDefaultQueue
    ) external nonReentrant onlyRole(Constants.ROLE_QUEUE_MANAGER)  {
        ConfiguratorLogic.ExecuteSetDefaultQueue(vaultData, newDefaultQueue);
    }

    function setUseDefaultQueue(bool useDefaultQueue) external onlyRole(Constants.ROLE_QUEUE_MANAGER)  {
        ConfiguratorLogic.ExecuteSetUseDefaultQueue(vaultData, useDefaultQueue);
    }

    function setAutoAllocate(bool autoAllocate) public onlyRole(Constants.ROLE_DEBT_MANAGER) {
        ConfiguratorLogic.ExecuteSetAutoAllocate(vaultData, autoAllocate);
    }

    function setDepositLimit(
        uint256 depositLimit
    ) external onlyRole(Constants.ROLE_DEPOSIT_LIMIT_MANAGER) {
        ConfiguratorLogic.ExecuteSetDepositLimit(
            vaultData,
            depositLimit,
            false
        );
    }

    function setDepositLimitForce(
        uint256 depositLimit
    ) external onlyRole(Constants.ROLE_DEPOSIT_LIMIT_MANAGER) {
        ConfiguratorLogic.ExecuteSetDepositLimit(vaultData, depositLimit, true);
    }

    function setDepositLimitModule(
        address newDepositLimitModule
    ) external onlyRole(Constants.ROLE_DEPOSIT_LIMIT_MANAGER) {
        ConfiguratorLogic.ExecuteSetDepositLimitModule(
            vaultData,
            newDepositLimitModule,
            false
        );
    }

    function setDepositLimitModuleForce(
        address newDepositLimitModule
    ) external onlyRole(Constants.ROLE_DEPOSIT_LIMIT_MANAGER) {
        ConfiguratorLogic.ExecuteSetDepositLimitModule(
            vaultData,
            newDepositLimitModule,
            true
        );
    }

    function setWithdrawLimitModule(
        address newWithdrawLimitModule
    ) external onlyRole(Constants.ROLE_WITHDRAW_LIMIT_MANAGER) {
        ConfiguratorLogic.ExecuteSetWithdrawLimitModule(
            vaultData,
            newWithdrawLimitModule
        );
    }

    function setAccountant(
        address newAccountant
    ) external onlyRole(Constants.ROLE_ACCOUNTANT_MANAGER) {
        ConfiguratorLogic.ExecuteSetAccountant(vaultData, newAccountant);
    }

    function setMinimumTotalIdle(
        uint256 newMinimumTotalIdle
    ) external onlyRole(Constants.ROLE_MINIMUM_IDLE_MANAGER) {
        ConfiguratorLogic.ExecuteSetMinimumTotalIdle(
            vaultData,
            newMinimumTotalIdle
        );
    }

    function setManagementFee(
        uint256 newManagementFee
    ) external onlyRole(Constants.ROLE_GOVERNANCE_MANAGER) {
        ConfiguratorLogic.ExecuteSetManagementFee(vaultData, newManagementFee);
    }

    function setFeeRecipient(
        address newFeeRecipient
    ) external onlyRole(Constants.ROLE_GOVERNANCE_MANAGER) {
        ConfiguratorLogic.ExecuteSetFeeRecipient(vaultData, newFeeRecipient);
    }

    // VIEW FUNCTIONS

    function strategies(
        address strategy
    ) public view returns (DataTypes.StrategyData memory) {
        return vaultData.strategies[strategy];
    }

    function pricePerShare() public view returns (uint256) {
        return ERC4626Logic.pricePerShare(vaultData);
    }
    function pricePerShareWithFee() public view returns (uint256) {
        return ERC4626Logic.pricePerShareWithFee(vaultData);
    }

    function totalDebt() public view returns (uint256) {
        return vaultData.totalDebt;
    }

    function totalIdle() public view returns (uint256) {
        return vaultData.totalIdle;
    }

    function minimumTotalIdle() public view returns (uint256) {
        return vaultData.minimumTotalIdle;
    }
}
