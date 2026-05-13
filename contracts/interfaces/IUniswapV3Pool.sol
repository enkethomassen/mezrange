// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUniswapV3Pool
/// @notice Minimal interface for Uniswap V3 pool interactions
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol
    ); // NOTE: Mezo DEX omits the `bool unlocked` field present in standard Uniswap V3
    function observe(uint32[] calldata secondsAgos) external view returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );
    /// @notice Returns the observation stored at a given index in the oracle array.
    /// @param index The element of the observations array to fetch.
    function observations(uint256 index) external view returns (
        uint32 blockTimestamp,
        int56 tickCumulative,
        uint160 secondsPerLiquidityCumulativeX128,
        bool initialized
    );
    function liquidity() external view returns (uint128);

    /// @notice Direct pool swap. Bypasses the router — required on Mezo testnet
    ///         where the deployed SwapRouter cannot resolve this pool's CREATE2
    ///         address. The caller MUST implement `uniswapV3SwapCallback` and
    ///         transfer the owed token(s) inside that callback or the swap reverts.
    /// @param recipient The address to receive the output tokens.
    /// @param zeroForOne True if swapping token0 → token1, false otherwise.
    /// @param amountSpecified Positive = exactIn (amount in), negative = exactOut.
    /// @param sqrtPriceLimitX96 Stop swapping once the pool's sqrtPrice crosses this.
    /// @param data Arbitrary data passed back to the caller in the callback.
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @notice Callback signature required by `IUniswapV3Pool.swap`.
///         The strategy implements this and pays the positive delta back to the pool.
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}
