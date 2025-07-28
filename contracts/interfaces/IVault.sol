// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IVault is IERC4626 {
    // Enums
    enum StrategyChangeType {
        ADDED,
        REVOKED
    }

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event RequestedWithdraw(address indexed user, uint256 shares);
    event Withdrawn(
        address indexed user,
        uint256 shares,
        uint256 amount,
        uint256 fee
    );
    event TreasuryTransferred();
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event GovernmentChanged(address newGovernment);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event StrategyChanged(
        address indexed strategy,
        StrategyChangeType changeType
    );
    event StrategyReported(
        address indexed strategy,
        uint256 gain,
        uint256 loss,
        uint256 currentDebt,
        uint256 performanceFee,
        uint256 refund
    );
    event DebtUpdated(
        address indexed strategy,
        uint256 currentDebt,
        uint256 newDebt
    );
    event UpdateAccountant(address indexed accountant);
    event UpdateDepositLimitModule(address indexed depositLimitModule);
    event UpdateWithdrawLimitModule(address indexed withdrawLimitModule);
    event UpdateDefaultQueue(address[] newDefaultQueue);
    event UpdateUseDefaultQueue(bool useDefaultQueue);
    event UpdateAutoAllocate(bool autoAllocate);
    event UpdateDepositLimit(uint256 depositLimit);
    event UpdateMinimumTotalIdle(uint256 minimumTotalIdle);
    event UpdateManagementFee(uint256 managementFee);
    event UpdateFeeRecipient(address feeRecipient);
    event UpdateProfitMaxUnlockTime(uint256 profitMaxUnlockTime);
    event DebtPurchased(address indexed strategy, uint256 amount);
    event ManagementFeeMinted(address indexed feeRecipient, uint256 amount);

    function mint(address receiver, uint256 assets) external;

    function burn(address receiver, uint256 assets) external;

    function spendAllowance(
        address owner,
        address spender,
        uint256 value
    ) external;

    function asset() external view returns (address);

    function decimals() external view returns (uint8);

    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256);
    function withdraw(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
}
