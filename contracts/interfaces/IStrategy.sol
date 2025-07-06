// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStrategy {
    function asset() external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);
}
