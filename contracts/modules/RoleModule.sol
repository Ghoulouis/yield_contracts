// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract RoleModule is AccessControl {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    constructor(address governance) {
        _grantRole(GOVERNANCE_ROLE, governance);
        _setRoleAdmin(PAUSER_ROLE, GOVERNANCE_ROLE);
        _setRoleAdmin(AGENT_ROLE, GOVERNANCE_ROLE);
        _setRoleAdmin(REPORTER_ROLE, GOVERNANCE_ROLE);
    }

    function changeGovernance(
        address newGovernance
    ) public onlyRole(GOVERNANCE_ROLE) {
        _revokeRole(GOVERNANCE_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, newGovernance);
    }
}
