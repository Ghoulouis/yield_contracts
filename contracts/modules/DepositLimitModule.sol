// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IDepositLimitModule.sol";
import "../interfaces/IVault.sol";

contract DepositLimitModule is IDepositLimitModule {
    address public governance;
    address public vault;
    uint256 public limitDeposit;

    modifier onlyGovernance() {
        require(msg.sender == governance, "only governance");
        _;
    }

    constructor(address _vault, address _governance) {
        vault = _vault;
        limitDeposit = type(uint256).max;
        governance = _governance;
    }

    function setLimitEachUser(uint256 _limitDeposit) external onlyGovernance {
        limitDeposit = _limitDeposit;
    }

    function availableDepositLimit(
        address receiver
    ) external view returns (uint256) {
        uint256 balance = IVault(vault).convertToAssets(
            IVault(vault).balanceOf(receiver)
        );
        return limitDeposit > balance ? limitDeposit - balance : 0;
    }
}
