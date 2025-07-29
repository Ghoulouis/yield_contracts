// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IWithdrawLimitModule.sol";
import "../interfaces/IVault.sol";

import "hardhat/console.sol";
contract WithdrawLimitModule is IWithdrawLimitModule {
    address public governance;
    address public vault;
    uint256 public limitWithdraw;

    modifier onlyGovernance() {
        require(msg.sender == governance, "only governance");
        _;
    }

    constructor(address _vault, address _governance) {
        vault = _vault;
        limitWithdraw = type(uint256).max;
        governance = _governance;
    }

    function setLimitEachUser(uint256 _limitWithdraw) external onlyGovernance {
        limitWithdraw = _limitWithdraw;
    }

    function availableWithdrawLimit(
        address,
        uint256,
        address[] calldata
    ) external view returns (uint256) {
        // to do
        return limitWithdraw;
    }
}
