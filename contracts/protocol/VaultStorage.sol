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

contract VaultStorage {
    uint256 public constant MAX_QUEUE = 10;
    string public constant API_VERSION = "0.0.1";
    uint256 public constant MAX_PROFIT_UNLOCK_TIME = 365 days;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_BPS_EXTENDED = 1_000_000_000_000;

    // Roles
    address public governance;
    address public beneficiary;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    // Enums
    enum StrategyChangeType {
        ADDED,
        REVOKED
    }

    // Storage
    struct StrategyParams {
        uint256 activation;
        uint256 lastReport;
        uint256 currentDebt;
        uint256 maxDebt;
    }

    mapping(address => StrategyParams) public strategies;

    address[] public defaultQueue;
    bool public useDefaultQueue;
    bool public autoAllocate;

    uint256 public totalDebt;
    uint256 public totalIdle;

    // Limits
    uint256 public minimumTotalIdle;
    uint256 public depositLimit;

    // Profit unlocking
    uint256 public profitMaxUnlockTime;
    uint256 public fullProfitUnlockDate;
    uint256 public profitUnlockingRate;
    uint256 public lastProfitUpdate;

    // Fee
    address public accountant;
    uint256 public protocolFeeBps;
    address public protocolFeeRecipient;

    // Modules
    address public roleModule;
    address public depositLimitModule;
    address public withdrawLimitModule;

    // pendind withdraw
    uint256 totalPendingWithdraw;
    mapping(address => uint256) pendingWithdraw;
}
