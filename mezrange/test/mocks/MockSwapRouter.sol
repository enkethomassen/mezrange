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

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        if (shouldRevert) revert("MockSwapRouter: swap failed");
        // Pull tokenIn from caller
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        // Send tokenOut to recipient (must be pre-funded)
        amountOut = params.amountIn; // 1:1 for testing
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
