// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IVault.sol";

contract WithdrawHelper {
    address vault;
    mapping(address => uint256) pendingWithdraw;

    function withdraw(uint256 amount) public {
        uint256 shares = IVault(vault).convertToShares(amount);
        uint256 maxAssets = IVault(vault).convertToAssets(
            IERC20(vault).balanceOf(msg.sender)
        );
        require(amount < maxAssets, "Insufficient LP");
        uint256 maxWithdraw = IVault(vault).maxWithdraw(msg.sender);
        if (maxWithdraw >= amount) {
            IERC20(vault).transferFrom(msg.sender, address(this), shares);
            IVault(vault).withdraw(shares, msg.sender, address(this));
        } else {
            pendingWithdraw[msg.sender] += amount;
        }
    }

    function trigger(address user) public {
        uint256 amount = pendingWithdraw[user];
        require(amount > 0, "No pending withdraw");
        pendingWithdraw[user] = 0;
        uint256 shares = IVault(vault).convertToShares(amount);
        IERC20(vault).transferFrom(msg.sender, address(this), shares);
        IVault(vault).withdraw(shares, msg.sender, user);
    }
}
