// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title INonfungiblePositionManager
/// @notice Interface for Mezo's CL (Velodrome Slipstream–style) NonfungiblePositionManager.
/// @dev    Mezo's DEX is a Slipstream/Velodrome-V3 fork, NOT vanilla Uniswap V3. Two ABI
///         differences are load-bearing and were the cause of every mint reverting:
///           1. `MintParams` carries `int24 tickSpacing` where Uniswap V3 has `uint24 fee`,
///              and appends a trailing `uint160 sqrtPriceX96` (pass 0 if the pool is already
///              initialized).
///           2. `positions()` returns `int24 tickSpacing` in the slot Uniswap V3 uses for
///              `uint24 fee`.
///         Canonical Mezo testnet PM verified on-chain: 0x509Bc221df2B83927c695FA0bb0f5B21053C874c
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        int24 tickSpacing;   // Mezo/Slipstream: replaces Uniswap V3's `uint24 fee`
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
        uint160 sqrtPriceX96; // Mezo/Slipstream addition: 0 when the pool already exists
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params) external payable returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );

    function collect(CollectParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );

    function burn(uint256 tokenId) external payable;

    function positions(uint256 tokenId) external view returns (
        uint96 nonce,
        address operator,
        address token0,
        address token1,
        int24 tickSpacing,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    );
}
