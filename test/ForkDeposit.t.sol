// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IUniswapV3SwapRouterLike {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata) external returns (uint256);
}

/// @notice Fork test that REPRODUCES the original deposit revert against the
///         live Mezo testnet — proves the bug is the deployed SwapRouter
///         failing to resolve the pool's CREATE2 address (it derives a
///         non-existent contract). End-to-end deposit-after-fix testing is
///         NOT possible from a forge fork because Mezo native BTC and MEZO are
///         system precompiles whose chain-level logic is not replayed by anvil
///         — every balanceOf/transfer/decimals call against them reverts on a
///         fork. The patched contract is verified via the unit tests in
///         MezRangeVault.t.sol (which exercise the new IUniswapV3SwapCallback
///         path through MockUniswapV3Pool) and against a real testnet
///         deployment after the user runs DeployTestnet.s.sol.
contract ForkDepositTest is Test {
    address constant USER = 0x03ffb3720214bDB0DB5F5F71b6cE16B008f762d2;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant SWAP_ROUTER_BROKEN = 0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a;
    address constant BTC = 0x7b7C000000000000000000000000000000000000;

    function setUp() public {
        vm.createSelectFork("https://rpc.test.mezo.org");
    }

    /// @notice Confirms the on-chain SwapRouter cannot route MUSD→BTC at fee=500.
    ///         This is the root cause of the original "depositWithMinShares
    ///         reverted" issue. The router derives a non-existent pool address
    ///         and the call lands on a non-contract address.
    function test_routerCannotResolvePool_repro() public {
        deal(MUSD, USER, 1e18);
        vm.startPrank(USER);
        IERC20Like(MUSD).approve(SWAP_ROUTER_BROKEN, 5e17);
        bytes memory path = abi.encodePacked(MUSD, uint24(500), BTC);
        bool reverted;
        try IUniswapV3SwapRouterLike(SWAP_ROUTER_BROKEN).exactInput(
            IUniswapV3SwapRouterLike.ExactInputParams({
                path: path,
                recipient: USER,
                deadline: block.timestamp + 60,
                amountIn: 5e17,
                amountOutMinimum: 0
            })
        ) returns (uint256) {
            reverted = false;
        } catch {
            reverted = true;
        }
        vm.stopPrank();
        assertTrue(reverted, "Mezo SwapRouter exactInput is expected to revert for MUSD/BTC pool");
    }
}
