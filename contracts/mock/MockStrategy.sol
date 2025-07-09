// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../strategy/BaseStrategy.sol";
import "hardhat/console.sol";

contract MockStrategy is BaseStrategy {
    using Math for uint256;
    using SafeERC20 for IERC20;

    uint public depositLimit;

    uint public totalIdle;
    uint public totalLocked;

    function setAgent(address _agent) public onlyGovernance {
        agent = _agent;
    }

    function setLoss(uint256 amount) public {
        totalIdle -= amount;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(previewWithdraw(totalIdle), balanceOf(owner));
    }

    function setMaxDebt(uint256 _depositLimit) public onlyGovernance {
        depositLimit = _depositLimit;
    }

    function maxDeposit(address owner) public view override returns (uint256) {
        if (depositLimit == 0) return type(uint256).max;
        return depositLimit - totalIdle - totalLocked;
    }

    function totalAssets() public view override returns (uint256) {
        return totalIdle + totalLocked;
    }

    function loss(uint256 amount) public {
        totalIdle -= amount;
    }

    function lock(uint256 amount) public {
        totalIdle -= amount;
        totalLocked += amount;
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        IERC20(asset()).safeTransferFrom(caller, address(this), assets);
        totalIdle += assets;
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        totalIdle -= assets;
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // If asset() is ERC-777, `transfer` can trigger a reentrancy AFTER the transfer happens through the
        // `tokensReceived` hook. On the other hand, the `tokensToSend` hook, that is triggered before the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer after the burn so that any reentrancy would happen after the
        // shares are burned and after the assets are transferred, which is a valid state.
        _burn(owner, shares);
        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function harvest() public {
        totalIdle = IERC20(asset()).balanceOf(address(this));
    }

    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view override returns (uint256) {
        if (shares == type(uint256).max || shares == 0) {
            return shares;
        }
        uint256 totalSupply_ = totalSupply();
        uint256 totalAssets_ = totalAssets();
        if (totalSupply_ == 0) {
            return shares * 10 ** _decimalsOffset();
        }
        uint256 numerator = shares * totalAssets_;
        uint256 amount = numerator / totalSupply_;
        if (rounding == Math.Rounding.Ceil && numerator % totalSupply_ != 0) {
            amount++;
        }
        return amount;
    }

    function _convertToShares(
        uint256 assets,
        Math.Rounding rounding
    ) internal view override returns (uint256) {
        if (assets == type(uint256).max || assets == 0) {
            return assets;
        }
        uint256 totalSupply_ = totalSupply();
        uint256 totalAssets_ = totalAssets();
        if (totalSupply_ == 0) {
            return assets * 10 ** _decimalsOffset();
        }
        uint256 numerator = assets * totalSupply_;
        uint256 shares = numerator / totalAssets_;
        if (rounding == Math.Rounding.Ceil && numerator % totalAssets_ != 0) {
            shares++;
        }
        return shares;
    }
}
