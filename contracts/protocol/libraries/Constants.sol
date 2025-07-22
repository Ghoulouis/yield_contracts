// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Constants {
    uint256 public constant MAX_QUEUE = 5;
    string public constant API_VERSION = "0.0.1";
    uint256 public constant MAX_PROFIT_UNLOCK_TIME = 365 days;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_BPS_EXTENDED = 1_000_000_000_000;
}
