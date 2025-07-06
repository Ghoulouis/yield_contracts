// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract BaseStrategy {
    function convertToAssets(uint256 shares) public virtual returns (uint256);
}
