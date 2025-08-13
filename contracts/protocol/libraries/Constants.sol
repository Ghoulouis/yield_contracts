// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Constants {
    uint256 public constant MAX_QUEUE = 20;
    string public constant API_VERSION = "0.0.1";
    uint256 public constant MAX_PROFIT_UNLOCK_TIME = 365 days;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_BPS_EXTENDED = 1_000_000_000_000;

    uint256 public constant YEAR = 365 * 24 * 60 * 60;

    bytes32 public constant ROLE_GOVERNANCE_MANAGER =
        keccak256("ROLE_GOVERNANCE_MANAGER");

    bytes32 public constant ROLE_ADD_STRATEGY_MANAGER =
        keccak256("ROLE_ADD_STRATEGY_MANAGER");

    bytes32 public constant ROLE_REVOKE_STRATEGY_MANAGER =
        keccak256("ROLE_REVOKE_STRATEGY_MANAGER");

    bytes32 public constant ROLE_ACCOUNTANT_MANAGER =
        keccak256("ROLE_ACCOUNTANT_MANAGER");

    bytes32 public constant ROLE_QUEUE_MANAGER =
        keccak256("ROLE_QUEUE_MANAGER");

    bytes32 public constant ROLE_REPORTING_MANAGER =
        keccak256("ROLE_REPORTING_MANAGER");

    bytes32 public constant ROLE_DEBT_MANAGER = keccak256("ROLE_DEBT_MANAGER");

    bytes32 public constant ROLE_MAX_DEBT_MANAGER =
        keccak256("ROLE_MAX_DEBT_MANAGER");

    bytes32 public constant ROLE_DEPOSIT_LIMIT_MANAGER =
        keccak256("ROLE_DEPOSIT_LIMIT_MANAGER");

    bytes32 public constant ROLE_WITHDRAW_LIMIT_MANAGER =
        keccak256("ROLE_WITHDRAW_LIMIT_MANAGER");

    bytes32 public constant ROLE_MINIMUM_IDLE_MANAGER =
        keccak256("ROLE_MINIMUM_IDLE_MANAGER");

    bytes32 public constant ROLE_PROFIT_UNLOCK_MANAGER =
        keccak256("ROLE_PROFIT_UNLOCK_MANAGER");

    bytes32 public constant ROLE_DEBT_PURCHASER =
        keccak256("ROLE_DEBT_PURCHASER");

    bytes32 public constant ROLE_EMERGENCY_MANAGER =
        keccak256("ROLE_EMERGENCY_MANAGER");
}
