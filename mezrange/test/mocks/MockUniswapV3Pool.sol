// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../contracts/interfaces/IUniswapV3Pool.sol";

/// @notice Minimal mock of a Uniswap V3 pool for testing
contract MockUniswapV3Pool is IUniswapV3Pool {
    struct Observation {
        uint32 blockTimestamp;
        int56 tickCumulative;
        uint160 secondsPerLiquidityCumulativeX128;
        bool initialized;
    }

    address public override token0;
    address public override token1;
    uint24  public override fee;

    int24   public currentTick;
    uint160 public sqrtPriceX96;
    uint128 public poolLiquidity;

    int56[] public tickCumulatives;
    bool    public observeReverts;
    Observation[] internal _observations;

    constructor(address _token0, address _token1, uint24 _fee) {
        token0 = _token0;
        token1 = _token1;
        fee    = _fee;
        sqrtPriceX96 = 79228162514264337593543950336; // 1:1 price
        currentTick  = 0;
        poolLiquidity = 1e18;
        _observations.push(
            Observation({
                blockTimestamp: uint32(block.timestamp),
                tickCumulative: 0,
                secondsPerLiquidityCumulativeX128: 0,
                initialized: true
            })
        );
    }

    function slot0() external view override returns (
        uint160 _sqrtPriceX96,
        int24   _tick,
        uint16, uint16, uint16, uint8, bool
    ) {
        return (sqrtPriceX96, currentTick, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        returns (int56[] memory _tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!observeReverts, "MockPool: observe reverts");
        _tickCumulatives = new int56[](secondsAgos.length);
        if (tickCumulatives.length >= secondsAgos.length) {
            for (uint i = 0; i < secondsAgos.length; i++) {
                _tickCumulatives[i] = tickCumulatives[i];
            }
        }
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
    }

    function observations(uint256 index)
        external
        view
        override
        returns (
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulativeX128,
            bool initialized
        )
    {
        if (index >= _observations.length) {
            return (0, 0, 0, false);
        }

        Observation memory observation = _observations[index];
        return (
            observation.blockTimestamp,
            observation.tickCumulative,
            observation.secondsPerLiquidityCumulativeX128,
            observation.initialized
        );
    }

    function liquidity() external view override returns (uint128) {
        return poolLiquidity;
    }

    // ── Test helpers ─────────────────────────────────────────────────────────

    function setTick(int24 _tick) external {
        currentTick = _tick;
    }

    function setSqrtPrice(uint160 _sqrt) external {
        sqrtPriceX96 = _sqrt;
    }

    function setTickCumulatives(int56 old_, int56 curr) external {
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = old_;
        tickCumulatives[1] = curr;

        if (_observations.length == 0) {
            _observations.push(
                Observation({
                    blockTimestamp: uint32(block.timestamp - 1),
                    tickCumulative: old_,
                    secondsPerLiquidityCumulativeX128: 0,
                    initialized: true
                })
            );
            _observations.push(
                Observation({
                    blockTimestamp: uint32(block.timestamp),
                    tickCumulative: curr,
                    secondsPerLiquidityCumulativeX128: 0,
                    initialized: true
                })
            );
            return;
        }

        _observations[0] = Observation({
            blockTimestamp: uint32(block.timestamp - 1),
            tickCumulative: old_,
            secondsPerLiquidityCumulativeX128: 0,
            initialized: true
        });

        if (_observations.length == 1) {
            _observations.push(
                Observation({
                    blockTimestamp: uint32(block.timestamp),
                    tickCumulative: curr,
                    secondsPerLiquidityCumulativeX128: 0,
                    initialized: true
                })
            );
        } else {
            _observations[1] = Observation({
                blockTimestamp: uint32(block.timestamp),
                tickCumulative: curr,
                secondsPerLiquidityCumulativeX128: 0,
                initialized: true
            });
        }
    }

    function setObserveReverts(bool _r) external {
        observeReverts = _r;
    }
}
