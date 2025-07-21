// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/IAccessControl.sol";

interface IRoleModule is IAccessControl {
    function availableDepositLimit(
        address receiver
    ) external view returns (uint256);
}
