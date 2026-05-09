// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUniswapV3SwapRouter
/// @notice Mezo DEX router only exposes exactInput (multi-hop path encoding),
///         not exactInputSingle. Single-hop swaps use a 3-token path:
///         abi.encodePacked(tokenIn, fee, tokenOut)
interface IUniswapV3SwapRouter {
    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
