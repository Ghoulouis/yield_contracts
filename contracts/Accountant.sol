// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAccountant.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Accountant is IAccountant, Initializable {
    address public governance;

    struct Fee {
        uint256 managementFee;
        uint256 performanceFee;
        uint256 refundRatio;
    }

    address public asset;
    mapping(address => Fee) public fees;
    uint256 public constant BASE_BPS = 10_000;

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    function initialize(address _governance) public initializer {
        governance = _governance;
    }

    function report(
        address strategy,
        uint256 gain,
        uint256 loss
    ) external returns (uint256 totalFees, uint256 totalRefunds) {
        Fee storage fee = fees[strategy];

        if (gain > 0) {
            totalFees = (gain * fee.performanceFee) / BASE_BPS;
            return (totalFees, 0);
        } else {
            totalRefunds = (loss * fee.refundRatio) / BASE_BPS;
            if (totalRefunds > 0) {
                IERC20(asset).approve(msg.sender, totalRefunds);
            }
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
