// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAccountant.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IVault} from "./interfaces/IVault.sol";
import "hardhat/console.sol";
contract Accountant is IAccountant {
    struct Fee {
        uint256 managementFee;
        uint256 performanceFee;
        uint256 refundRatio;
    }

    address public asset;
    address public vault;
    address public governance;

    mapping(address => Fee) public fees;
    uint256 public constant BASE_BPS = 10_000;

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Not governance");
        _;
    }

    constructor(address _asset, address _vault, address _governance) {
        asset = _asset;
        vault = _vault;
        governance = _governance;
    }

    function report(
        address strategy,
        uint256 gain,
        uint256 loss
    ) external onlyVault returns (uint256 performanceFee, uint256 refund) {
        Fee storage fee = fees[strategy];
        if (gain > 0) {
            performanceFee = (gain * fee.performanceFee) / BASE_BPS;
            return (performanceFee, 0);
        } else {
            refund = (loss * fee.refundRatio) / BASE_BPS;
            if (refund > 0) {
                IERC20(asset).approve(msg.sender, refund);
            }
        }
        return (performanceFee, refund);
    }

    function setManagementFee(
        address strategy,
        uint256 _managementFee
    ) external onlyGovernance {
        require(_managementFee <= BASE_BPS, "Invalid management fee");
        fees[strategy].managementFee = _managementFee;
    }

    function setPerformanceFee(
        address strategy,
        uint256 _performanceFee
    ) external onlyGovernance {
        require(_performanceFee <= BASE_BPS, "Invalid performance fee");
        fees[strategy].performanceFee = _performanceFee;
    }

    function setRefundRatio(
        address strategy,
        uint256 _refundRatio
    ) external onlyGovernance {
        require(_refundRatio <= BASE_BPS, "Invalid refund ratio");
        fees[strategy].refundRatio = _refundRatio;
    }

    function withdraw(
        uint256 amount,
        address receiver
    ) external onlyGovernance {
        IVault(vault).withdraw(amount, receiver, address(this));
    }
}
