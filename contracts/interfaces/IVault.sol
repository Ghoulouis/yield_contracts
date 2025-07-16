// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IVault is IERC4626 {
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256);
    function withdraw(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) external view returns (uint256);
}
