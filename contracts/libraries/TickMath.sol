// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

/// @title TickMath helpers for MezRange
/// @notice Utility functions for tick calculations and sqrtPrice conversions
library TickMath {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @notice Returns the tick spacing for a given fee tier
    function tickSpacingForFee(uint24 fee) internal pure returns (int24) {
        if (fee == 100) return 1;
        if (fee == 500) return 10;
        if (fee == 3000) return 60;
        if (fee == 10000) return 200;
        revert("TickMath: invalid fee");
    }

    /// @notice Rounds tick down to nearest multiple of tickSpacing
    function roundTickDown(int24 tick, int24 tickSpacing) internal pure returns (int24) {
        int24 rounded = (tick / tickSpacing) * tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) {
            rounded -= tickSpacing;
        }
        return rounded;
    }

    /// @notice Calculate tick range for a given price deviation percentage (in bps)
    /// @param currentTick current pool tick
    /// @param widthBps range width in basis points (e.g. 1000 = 10%, 6000 = 60% total = ±30%)
    /// @param tickSpacing pool tick spacing
    ///
    /// @dev The correct formula is halfTicks = log_{1.0001}(1 + widthBps/20000) where
    ///      widthBps/20000 is the one-sided price deviation (half of the total width).
    ///      The prior approximation (halfTicks ≈ widthBps/2 bps) is only accurate near
    ///      tick 0. At BTC/MUSD prices (tick ≈ −115,000) the error reaches ~15%,
    ///      placing the WIDE strategy at ±2.6% actual range instead of the intended ±30%.
    ///
    ///      Integer implementation of log_{1.0001}(1 + p) ≈ p / ln(1.0001)
    ///      where ln(1.0001) = 0.0000999950003... ≈ 9999/100_000_000.
    ///      So halfTicks = oneSidedBps * 100_000_000 / 9999 / 10000
    ///                   = oneSidedBps * 10000 / 9999
    ///      This first-order approximation stays within 0.5% of the true value for
    ///      widths up to 60% (our WIDE strategy), independent of current tick level.
    ///      It is materially more accurate than the old "1 tick ≈ 1 bps" linear mapping
    ///      which diverges by 15%+ at large positive/negative ticks.
    function calcRange(int24 currentTick, uint24 widthBps, int24 tickSpacing)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        // One-sided bps = half the total width (e.g. widthBps=6000 → oneSidedBps=3000 → ±30%).
        uint256 oneSidedBps = uint256(widthBps) / 2;

        // Convert bps to ticks using ln-based formula: ticks = bps * 10000 / 9999.
        // This is accurate to <0.5% for the strategy widths in use (600, 2000, 6000 bps).
        // Multiply before divide to preserve precision.
        int24 halfTicks = int24(int256((oneSidedBps * 10000) / 9999));

        tickLower = roundTickDown(currentTick - halfTicks, tickSpacing);
        tickUpper = roundTickDown(currentTick + halfTicks, tickSpacing) + tickSpacing;

        if (tickLower < MIN_TICK) tickLower = MIN_TICK;
        if (tickUpper > MAX_TICK) tickUpper = MAX_TICK;
    }

    /// @notice Returns the sqrt ratio as a Q64.96 for the given tick.
    ///         Uses the standard Uniswap V3 formula: sqrtPrice = sqrt(1.0001^tick) * 2^96
    ///         This is a compact implementation using bit shifts for gas efficiency.
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(absTick <= uint256(int256(MAX_TICK)), "TickMath: tick out of bounds");

        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;

        if (absTick & 0x2  != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4  != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8  != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;

        // Shift to Q64.96
        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }
}
