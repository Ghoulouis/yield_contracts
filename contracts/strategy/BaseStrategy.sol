// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

import "../interfaces/IStrategy.sol";

abstract contract BaseStrategy is ERC4626Upgradeable {
    address public vault;
    address public governance;
    address public agent;

    modifier onlyAgent() {
        require(msg.sender == agent, "Not agent");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Not vault");
        _;
    }

    function initialize(
        address _vault,
        address _governance,
        address _agent,
        IERC20 _asset,
        string memory name_,
        string memory symbol_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        __ERC4626_init(_asset);
        vault = _vault;
        governance = _governance;
        agent = _agent;
    }

    function setVault(address _vault) public onlyGovernance {
        vault = _vault;
    }

    function setGovernance(address _governance) public onlyGovernance {
        governance = _governance;
    }
}
