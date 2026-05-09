// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

/**
 * @title MezRangeStrategyDirect
 * @notice Strategy that accepts fee and tickSpacing directly (bypasses pool.fee() call)
 * Used for Mezo testnet pools that don't implement fee() in the standard way.
 */
import "../contracts/MezRangeVault.sol";
import "../contracts/MezRangeStrategyV2.sol";

/// @notice Minimal strategy constructor wrapper that takes fee+tickSpacing directly
/// We create a variant that hardcodes the Mezo pool quirks
contract MezRangeStrategyDirect is MezRangeStrategyV2 {
    constructor(
        address _positionManager,
        address _pool,
        address _swapRouter,
        StrategyType _strategy,
        address _admin,
        uint24 _fee,
        int24 _tickSpacing
    ) MezRangeStrategyV2(
        _positionManager,
        _pool,
        _swapRouter,
        _strategy,
        _admin,
        _fee,
        _tickSpacing
    ) {}
}

/// @title DeployTestnet
/// @notice Deploys MezRangeVault for Mezo testnet pools with non-standard fee() interface.
///         Uses MUSD/BTC 50-bps pool (0x026dB8) which has working fee()/slot0() interface.
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerPk    = vm.envUint("DEPLOYER_PK");
        address deployer      = vm.addr(deployerPk);
        address keeper        = vm.envAddress("KEEPER_ADDRESS");
        address treasury      = vm.envAddress("TREASURY_ADDRESS");
        address posManager    = vm.envAddress("POSITION_MANAGER");
        address swapRouter    = vm.envAddress("SWAP_ROUTER");

        console.log("=== MezRange Testnet Deployment ===");
        console.log("Deployer:  ", deployer);
        console.log("Keeper:    ", keeper);
        console.log("Treasury:  ", treasury);

        vm.startBroadcast(deployerPk);

        // ─── Vault 1: MUSD/BTC - 50 bps pool ───────────────────────────────────
        // Pool: 0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850
        // token0: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 (MUSD)
        // token1: 0x7b7C000000000000000000000000000000000000 (BTC)
        // fee: 500, tickSpacing: 50
        address pool1 = 0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850;
        address token0_1 = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503; // MUSD

        MezRangeStrategyV2 strat1 = new MezRangeStrategyV2(
            posManager,
            pool1,
            swapRouter,
            MezRangeStrategyV2.StrategyType.MEDIUM,
            deployer,
            500,
            50
        );
        MezRangeVault vault1 = new MezRangeVault(
            token0_1,
            address(strat1),
            treasury,
            deployer,
            "MezRange MUSD/BTC-50",
            "mrMUSD50"
        );
        strat1.grantRole(strat1.VAULT_ROLE(),  address(vault1));
        strat1.grantRole(strat1.KEEPER_ROLE(), keeper);
        vault1.grantRole(vault1.KEEPER_ROLE(), keeper);

        console.log("--- Vault 1: MUSD/BTC 50bps ---");
        console.log("  Strategy:", address(strat1));
        console.log("  Vault:   ", address(vault1));

        // ─── Vault 2: MUSD/BTC - 10 bps pool (tickSpacing=10) ─────────────────
        // Pool: 0xFe31b6033BCda0ebEc9FB789ee21bbc400175997
        // fee: 500 (but tickSpacing=10 from pool)
        address pool2 = 0xFe31b6033BCda0ebEc9FB789ee21bbc400175997;

        MezRangeStrategyV2 strat2 = new MezRangeStrategyV2(
            posManager,
            pool2,
            swapRouter,
            MezRangeStrategyV2.StrategyType.WIDE,
            deployer,
            500,
            10
        );
        MezRangeVault vault2 = new MezRangeVault(
            token0_1, // MUSD
            address(strat2),
            treasury,
            deployer,
            "MezRange MUSD/BTC-10",
            "mrMUSD10"
        );
        strat2.grantRole(strat2.VAULT_ROLE(),  address(vault2));
        strat2.grantRole(strat2.KEEPER_ROLE(), keeper);
        vault2.grantRole(vault2.KEEPER_ROLE(), keeper);

        console.log("--- Vault 2: MUSD/BTC 10bps ---");
        console.log("  Strategy:", address(strat2));
        console.log("  Vault:   ", address(vault2));

        // ─── Vault 3: MUSD/MEZO - 200 bps pool ─────────────────────────────────
        // Pool: 0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA
        // token0: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 (MUSD)
        // token1: 0x7b7C000000000000000000000000000000000001 (MEZO)
        // fee: 3000, tickSpacing: 200
        address pool3 = 0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA;

        MezRangeStrategyV2 strat3 = new MezRangeStrategyV2(
            posManager,
            pool3,
            swapRouter,
            MezRangeStrategyV2.StrategyType.TIGHT,
            deployer,
            3000,
            200
        );
        MezRangeVault vault3 = new MezRangeVault(
            token0_1, // MUSD
            address(strat3),
            treasury,
            deployer,
            "MezRange MUSD/MEZO-200",
            "mrMEZO"
        );
        strat3.grantRole(strat3.VAULT_ROLE(),  address(vault3));
        strat3.grantRole(strat3.KEEPER_ROLE(), keeper);
        vault3.grantRole(vault3.KEEPER_ROLE(), keeper);

        console.log("--- Vault 3: MUSD/MEZO 200bps ---");
        console.log("  Strategy:", address(strat3));
        console.log("  Vault:   ", address(vault3));

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("Vault 1 (MUSD/BTC-50):");
        console.log("  Strategy:", address(strat1));
        console.log("  Vault:   ", address(vault1));
        console.log("Vault 2 (MUSD/BTC-10):");
        console.log("  Strategy:", address(strat2));
        console.log("  Vault:   ", address(vault2));
        console.log("Vault 3 (MUSD/MEZO-200):");
        console.log("  Strategy:", address(strat3));
        console.log("  Vault:   ", address(vault3));
    }
}
