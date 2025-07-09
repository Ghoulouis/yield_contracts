// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IAccountant.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";
contract FlexibleAccountant is IAccountant, Initializable {
    using Math for uint256;
    address public governance;

    struct Fee {
        uint256 managementFee;
        uint256 performanceFee;
        uint256 refundRatio;
    }

    address public asset;
    mapping(address => Fee) public fees;
    uint256 public immutable base_pbs = 10000;

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    function initialize(
        address _governance,
        address _asset
    ) public initializer {
        governance = _governance;
        asset = _asset;
    }

    function report(
        address strategy,
        uint256 gain,
        uint256 loss
    ) external returns (uint256 totalFees, uint256 totalRefunds) {
        Fee storage fee = fees[strategy];

        uint256 assetBalance = IERC20(asset).balanceOf(address(this));

        if (gain > 0) {
            totalFees = (gain * fee.performanceFee) / base_pbs;
            totalRefunds = Math.min(
                assetBalance,
                (gain * fee.refundRatio) / base_pbs
            );
        } else {
            totalRefunds = (loss * fee.refundRatio) / base_pbs;
        }
        if (totalRefunds > 0) {
            IERC20(asset).approve(msg.sender, totalRefunds);
        }
        return (totalFees, totalRefunds);
    }

    function setManagementFee(
        address strategy,
        uint256 _managementFee
    ) external onlyGovernance {
        fees[strategy].managementFee = _managementFee;
    }

    function setPerformanceFee(
        address strategy,
        uint256 _performanceFee
    ) external onlyGovernance {
        fees[strategy].performanceFee = _performanceFee;
    }

    function setRefundRatio(
        address strategy,
        uint256 _refundRatio
    ) external onlyGovernance {
        fees[strategy].refundRatio = _refundRatio;
    }
}
