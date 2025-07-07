// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAccountant.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract Accountant is IAccountant, Initializable {
    address public governance;

    uint256 public immutable base_pbs = 10000;
    uint256 public fee_pbs = 1000;

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    function initialize(
        address _governance,
        uint256 _fee_pbs
    ) public initializer {
        governance = _governance;
        fee_pbs = _fee_pbs;
    }

    function report(
        address strategy,
        uint256 gain,
        uint256 loss
    ) external view returns (uint256 totalFees, uint256 totalRefunds) {
        if (gain > loss) {
            totalFees = ((gain - loss) * fee_pbs) / base_pbs;
            totalRefunds = 0;
        } else {
            totalFees = 0;
            totalRefunds = 0;
        }
    }

    function setFeePbs(uint256 _fee_pbs) external onlyGovernance {
        fee_pbs = _fee_pbs;
    }
}
