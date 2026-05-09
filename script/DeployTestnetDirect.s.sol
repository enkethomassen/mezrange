// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/MezRangeVault.sol";
import "../contracts/MezRangeStrategyV2.sol";

/// @title DeployTestnetDirect
/// @notice Deploys MezRange vaults on Mezo Testnet using MezRangeStrategyV2
///         which accepts fee and tickSpacing directly (handles non-standard pool interfaces).
///
/// Pools used:
///   MUSD/BTC-50:   0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850  fee=500  ts=50
///   MUSD/BTC-10:   0xFe31b6033BCda0ebEc9FB789ee21bbc400175997  fee=500  ts=10
///   MUSD/MEZO-200: 0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA  fee=3000 ts=200
contract DeployTestnetDirect is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer   = vm.addr(deployerPk);
        address keeper     = vm.envAddress("KEEPER_ADDRESS");
        address treasury   = vm.envAddress("TREASURY_ADDRESS");
        address posManager = vm.envAddress("POSITION_MANAGER");
        address swapRouter = vm.envAddress("SWAP_ROUTER");

        // MUSD token address (token0 for all vaults)
        address MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

        console.log("=== MezRange Testnet Deployment (Direct) ===");
        console.log("Deployer:  ", deployer);
        console.log("Keeper:    ", keeper);
        console.log("Treasury:  ", treasury);
        console.log("PosManager:", posManager);
        console.log("SwapRouter:", swapRouter);

        vm.startBroadcast(deployerPk);

        // ── Vault 1: MUSD/BTC 50bps ───────────────────────────────────────────
        address pool1 = 0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850;
        MezRangeStrategyV2 strat1 = new MezRangeStrategyV2(
            posManager, pool1, swapRouter,
            MezRangeStrategyV2.StrategyType.MEDIUM,
            deployer,
            500,  // fee
            50    // tickSpacing (Mezo non-standard: 500->50)
        );
        MezRangeVault vault1 = new MezRangeVault(
            MUSD, address(strat1), treasury, deployer,
            "MezRange MUSD/BTC-50", "mrMUSD50"
        );
        strat1.grantRole(strat1.VAULT_ROLE(),  address(vault1));
        strat1.grantRole(strat1.KEEPER_ROLE(), keeper);
        vault1.grantRole(vault1.KEEPER_ROLE(), keeper);
        console.log("Vault 1 Strategy:", address(strat1));
        console.log("Vault 1 Vault:   ", address(vault1));

        // ── Vault 2: MUSD/BTC 10bps ───────────────────────────────────────────
        address pool2 = 0xFe31b6033BCda0ebEc9FB789ee21bbc400175997;
        MezRangeStrategyV2 strat2 = new MezRangeStrategyV2(
            posManager, pool2, swapRouter,
            MezRangeStrategyV2.StrategyType.WIDE,
            deployer,
            500,  // fee
            10    // tickSpacing
        );
        MezRangeVault vault2 = new MezRangeVault(
            MUSD, address(strat2), treasury, deployer,
            "MezRange MUSD/BTC-10", "mrMUSD10"
        );
        strat2.grantRole(strat2.VAULT_ROLE(),  address(vault2));
        strat2.grantRole(strat2.KEEPER_ROLE(), keeper);
        vault2.grantRole(vault2.KEEPER_ROLE(), keeper);
        console.log("Vault 2 Strategy:", address(strat2));
        console.log("Vault 2 Vault:   ", address(vault2));

        // ── Vault 3: MUSD/MEZO 200bps ─────────────────────────────────────────
        address pool3 = 0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA;
        MezRangeStrategyV2 strat3 = new MezRangeStrategyV2(
            posManager, pool3, swapRouter,
            MezRangeStrategyV2.StrategyType.TIGHT,
            deployer,
            3000, // fee
            200   // tickSpacing (Mezo non-standard: 3000->200)
        );
        MezRangeVault vault3 = new MezRangeVault(
            MUSD, address(strat3), treasury, deployer,
            "MezRange MUSD/MEZO-200", "mrMEZO"
        );
        strat3.grantRole(strat3.VAULT_ROLE(),  address(vault3));
        strat3.grantRole(strat3.KEEPER_ROLE(), keeper);
        vault3.grantRole(vault3.KEEPER_ROLE(), keeper);
        console.log("Vault 3 Strategy:", address(strat3));
        console.log("Vault 3 Vault:   ", address(vault3));

        vm.stopBroadcast();

        console.log("\n=== COPY THESE TO deployedContracts.ts ===");
        console.log("btcMusd.strategy:", address(strat1));
        console.log("btcMusd.vault:   ", address(vault1));
        console.log("btcMusd.pool:    ", pool1);
        console.log("btcMusd10.strategy:", address(strat2));
        console.log("btcMusd10.vault:   ", address(vault2));
        console.log("mezoMusd.strategy:", address(strat3));
        console.log("mezoMusd.vault:   ", address(vault3));
        console.log("positionManager: ", posManager);
        console.log("swapRouter:      ", swapRouter);
        console.log("keeperBot:       ", keeper);
    }
}
