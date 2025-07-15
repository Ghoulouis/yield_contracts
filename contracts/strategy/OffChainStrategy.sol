// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BaseStrategy.sol";
import "hardhat/console.sol";
contract OffChainStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    uint256 public totalIdle;
    uint256 public _totalAssets;

    function setAgent(address _agent) public onlyGovernance {
        agent = _agent;
    }

    function totalAssets() public view override returns (uint256) {
        return _totalAssets;
    }

    function _setTotalAssets(uint256 amount) internal {
        _totalAssets = amount;
    }

    function deposit(
        uint256 assets,
        address receiver
    ) public override onlyVault returns (uint256) {
        totalIdle += assets;
        _totalAssets += assets;

        return super.deposit(assets, receiver);
    }

    function mint(
        uint256 assets,
        address receiver
    ) public override onlyVault returns (uint256) {
        return super.mint(assets, receiver);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        console.log("Max redeem:", Math.min(convertToShares(totalIdle), super.maxRedeem(owner)));
        return Math.min(convertToShares(totalIdle), super.maxRedeem(owner));
    }

    function invest(uint256 amount) public onlyAgent {
        require(agent != address(0), "Agent not set");
        require(amount > 0, "Invalid amount");
        require(totalIdle >= amount, "Insufficient idle");
        IERC20(asset()).transfer(agent, amount);
        totalIdle -= amount;
    }

    function takeProfit(uint256 amount) public onlyAgent {
        require(agent != address(0), "Agent not set");
        require(amount > 0, "Invalid amount");
        IERC20(asset()).transfer(agent, amount);
        totalIdle += amount;
    }
}
