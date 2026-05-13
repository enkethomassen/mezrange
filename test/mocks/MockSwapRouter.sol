// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../contracts/interfaces/IUniswapV3SwapRouter.sol";

/// @notice Mock swap router: swaps tokenIn for tokenOut at 1:1 ratio (simplified).
///         Set shouldRevert = true to simulate a failed swap mid-rebalance.
contract MockSwapRouter is IUniswapV3SwapRouter {
    bool public shouldRevert;

    /// @notice Toggle revert mode — used by failed-swap tests.
    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        if (shouldRevert) revert("MockSwapRouter: swap failed");
        // Decode tokenIn from the start of the path (first 20 bytes)
        address tokenIn;
        address tokenOut;
        assembly {
            // path is bytes: offset stored in params, first 20 bytes = tokenIn, last 20 bytes = tokenOut
        }
        // Simpler: decode from encoded path (tokenIn = first 20 bytes, tokenOut = last 20 bytes)
        bytes memory path = params.path;
        assembly {
            tokenIn  := shr(96, mload(add(path, 32)))
            tokenOut := shr(96, mload(add(path, 55)))
        }
        // Pull tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        // Send tokenOut to recipient at 1:1 for testing
        amountOut = params.amountIn;
        IERC20(tokenOut).transfer(params.recipient, amountOut);
    }
}
