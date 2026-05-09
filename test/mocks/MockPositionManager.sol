// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../contracts/interfaces/INonfungiblePositionManager.sol";
import "../../contracts/libraries/TickMath.sol";
import "../../contracts/libraries/LiquidityAmounts.sol";

/// @notice Minimal mock of the Uniswap V3 NonfungiblePositionManager for testing
contract MockPositionManager is INonfungiblePositionManager {
    uint256 public nextTokenId = 1;
    mapping(uint256 => uint128) public posLiquidity;
    mapping(uint256 => address) public posToken0;
    mapping(uint256 => address) public posToken1;
    mapping(uint256 => int24)   public posTickLower;
    mapping(uint256 => int24)   public posTickUpper;
    mapping(uint256 => uint256) public posAmount0;
    mapping(uint256 => uint256) public posAmount1;
    mapping(uint256 => uint128) public posOwed0;
    mapping(uint256 => uint128) public posOwed1;
    mapping(uint256 => bool)    public burned;

    event NFTMinted(uint256 tokenId, address recipient);

    function mint(MintParams calldata params)
        external
        payable
        override
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextTokenId++;
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            TickMath.getSqrtRatioAtTick(0),
            TickMath.getSqrtRatioAtTick(params.tickLower),
            TickMath.getSqrtRatioAtTick(params.tickUpper),
            amount0,
            amount1
        );

        posLiquidity[tokenId] = liquidity;
        posToken0[tokenId]    = params.token0;
        posToken1[tokenId]    = params.token1;
        posTickLower[tokenId] = params.tickLower;
        posTickUpper[tokenId] = params.tickUpper;
        posAmount0[tokenId]   = amount0;
        posAmount1[tokenId]   = amount1;

        // Pull tokens from caller
        IERC20(params.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(params.token1).transferFrom(msg.sender, address(this), amount1);

        emit NFTMinted(tokenId, params.recipient);
    }

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        override
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            TickMath.getSqrtRatioAtTick(0),
            TickMath.getSqrtRatioAtTick(posTickLower[params.tokenId]),
            TickMath.getSqrtRatioAtTick(posTickUpper[params.tokenId]),
            amount0,
            amount1
        );
        posLiquidity[params.tokenId] += liquidity;
        posAmount0[params.tokenId] += amount0;
        posAmount1[params.tokenId] += amount1;
        address t0 = posToken0[params.tokenId];
        address t1 = posToken1[params.tokenId];
        IERC20(t0).transferFrom(msg.sender, address(this), amount0);
        IERC20(t1).transferFrom(msg.sender, address(this), amount1);
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        override
        returns (uint256 amount0, uint256 amount1)
    {
        uint128 liq = posLiquidity[params.tokenId];
        uint128 rem = params.liquidity > liq ? liq : params.liquidity;
        uint256 amount0Share = liq == 0 ? 0 : (posAmount0[params.tokenId] * rem) / liq;
        uint256 amount1Share = liq == 0 ? 0 : (posAmount1[params.tokenId] * rem) / liq;
        posLiquidity[params.tokenId] -= rem;
        posAmount0[params.tokenId] -= amount0Share;
        posAmount1[params.tokenId] -= amount1Share;
        posOwed0[params.tokenId] += uint128(amount0Share);
        posOwed1[params.tokenId] += uint128(amount1Share);
        amount0 = amount0Share;
        amount1 = amount1Share;
    }

    function collect(CollectParams calldata params)
        external
        payable
        override
        returns (uint256 amount0, uint256 amount1)
    {
        amount0 = uint256(posOwed0[params.tokenId]);
        amount1 = uint256(posOwed1[params.tokenId]);
        posOwed0[params.tokenId] = 0;
        posOwed1[params.tokenId] = 0;
        address t0 = posToken0[params.tokenId];
        address t1 = posToken1[params.tokenId];
        if (amount0 > 0 && IERC20(t0).balanceOf(address(this)) >= amount0)
            IERC20(t0).transfer(params.recipient, amount0);
        if (amount1 > 0 && IERC20(t1).balanceOf(address(this)) >= amount1)
            IERC20(t1).transfer(params.recipient, amount1);
    }

    function burn(uint256 tokenId) external payable override {
        require(posLiquidity[tokenId] == 0, "MockPM: liquidity not zero");
        burned[tokenId] = true;
    }

    function positions(uint256 tokenId)
        external
        view
        override
        returns (
            uint96, address, address, address, uint24,
            int24, int24, uint128, uint256, uint256, uint128, uint128
        )
    {
        return (
            0, address(0),
            posToken0[tokenId],
            posToken1[tokenId],
            3000,
            posTickLower[tokenId],
            posTickUpper[tokenId],
            posLiquidity[tokenId],
            0, 0,
            posOwed0[tokenId],
            posOwed1[tokenId]
        );
    }

    // Test helper: seed fees for collect
    function seedFees(uint256 tokenId, uint128 fees0, uint128 fees1) external {
        posOwed0[tokenId] += fees0;
        posOwed1[tokenId] += fees1;
        if (posToken0[tokenId] != address(0)) {
            // caller must pre-fund this mock
        }
    }
}
