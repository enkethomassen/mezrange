// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/MezRangeStrategy.sol";
import "../contracts/MezRangeVault.sol";

/// @title Deploy
/// @notice Deploys MezRangeStrategy and MezRangeVault on Mezo testnet.
///         Grants all required roles correctly.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $RPC_URL \
///     --broadcast \
///     --verify \
///     -vvvv
///
/// Required env vars (set in .env or export):
///   DEPLOYER_PK       - Deployer private key
///   KEEPER_ADDRESS    - Keeper bot wallet address (gets KEEPER_ROLE)
///   TREASURY_ADDRESS  - Treasury address (receives protocol fees)
///   TOKEN0_ADDRESS    - token0 address on Mezo testnet
///   POOL_ADDRESS      - Uniswap V3-compatible pool address on Mezo testnet
///   POSITION_MANAGER  - NonfungiblePositionManager address on Mezo testnet
///   SWAP_ROUTER       - SwapRouter address on Mezo testnet
///
/// After deployment, update src/data/deployedContracts.ts with the printed addresses.
contract Deploy is Script {
    function run() external {
        uint256 deployerPk    = vm.envUint("DEPLOYER_PK");
        address deployer      = vm.addr(deployerPk);
        address keeper        = vm.envAddress("KEEPER_ADDRESS");
        address treasury      = vm.envAddress("TREASURY_ADDRESS");
        address token0        = vm.envAddress("TOKEN0_ADDRESS");
        address pool          = vm.envAddress("POOL_ADDRESS");
        address posManager    = vm.envAddress("POSITION_MANAGER");
        address swapRouter    = vm.envAddress("SWAP_ROUTER");

        console.log("=== MezRange Deployment ===");
        console.log("Deployer:  ", deployer);
        console.log("Keeper:    ", keeper);
        console.log("Treasury:  ", treasury);
        console.log("Token0:    ", token0);
        console.log("Pool:      ", pool);
        console.log("PosManager:", posManager);
        console.log("SwapRouter:", swapRouter);
        console.log("===========================");

        vm.startBroadcast(deployerPk);

        // ── 1. Deploy Strategy ────────────────────────────────────────────────
        MezRangeStrategy strategy = new MezRangeStrategy(
            posManager,
            pool,
            swapRouter,
            MezRangeStrategy.StrategyType.MEDIUM,
            deployer
        );
        console.log("MezRangeStrategy deployed at:", address(strategy));

        // ── 2. Deploy Vault ───────────────────────────────────────────────────
        MezRangeVault vault = new MezRangeVault(
            token0,
            address(strategy),
            treasury,
            deployer,
            "MezRange LP Vault",
            "mrVAULT"
        );
        console.log("MezRangeVault deployed at:", address(vault));

        // ── 3. Grant roles ────────────────────────────────────────────────────

        // Vault must have VAULT_ROLE on strategy to call addLiquidity/removeLiquidity
        strategy.grantRole(strategy.VAULT_ROLE(), address(vault));
        console.log("Granted VAULT_ROLE to vault on strategy");

        // Keeper bot must have KEEPER_ROLE on strategy for rebalance + collectAndCompound
        strategy.grantRole(strategy.KEEPER_ROLE(), keeper);
        console.log("Granted KEEPER_ROLE to keeper on strategy");

        // Keeper bot must have KEEPER_ROLE on vault for compoundFees
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        console.log("Granted KEEPER_ROLE to keeper on vault");

        vm.stopBroadcast();

        // ── 4. Summary ────────────────────────────────────────────────────────
        console.log("\n=== Deployment Summary ===");
        console.log("MezRangeStrategy:", address(strategy));
        console.log("MezRangeVault:   ", address(vault));
        console.log("Keeper address:  ", keeper);
        console.log("Treasury:        ", treasury);
        console.log("\nUpdate src/data/deployedContracts.ts with these addresses.");
        console.log("Then set STRATEGY_ADDRS=<strategy> in keeper/.env and start the keeper bot.");
    }
}

/// @title DeployMultiVault
/// @notice Deploys three vaults for BTC/mUSD, MEZO/mUSD, BTC/MEZO pairs
contract DeployMultiVault is Script {
    struct VaultConfig {
        string  name;
        string  symbol;
        address token0;
        address pool;
        MezRangeStrategy.StrategyType strategyType;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer   = vm.addr(deployerPk);
        address keeper     = vm.envAddress("KEEPER_ADDRESS");
        address treasury   = vm.envAddress("TREASURY_ADDRESS");
        address posManager = vm.envAddress("POSITION_MANAGER");
        address swapRouter = vm.envAddress("SWAP_ROUTER");

        VaultConfig[] memory configs = new VaultConfig[](3);

        configs[0] = VaultConfig({
            name: "MezRange BTC/mUSD",
            symbol: "mrBTC",
            token0: vm.envAddress("BTC_ADDRESS"),
            pool: vm.envAddress("BTC_MUSD_POOL"),
            strategyType: MezRangeStrategy.StrategyType.MEDIUM
        });
        configs[1] = VaultConfig({
            name: "MezRange MEZO/mUSD",
            symbol: "mrMEZO",
            token0: vm.envAddress("MEZO_ADDRESS"),
            pool: vm.envAddress("MEZO_MUSD_POOL"),
            strategyType: MezRangeStrategy.StrategyType.TIGHT
        });
        configs[2] = VaultConfig({
            name: "MezRange BTC/MEZO",
            symbol: "mrBTCMEZO",
            token0: vm.envAddress("BTC_ADDRESS"),
            pool: vm.envAddress("BTC_MEZO_POOL"),
            strategyType: MezRangeStrategy.StrategyType.WIDE
        });

        vm.startBroadcast(deployerPk);

        for (uint i = 0; i < configs.length; i++) {
            VaultConfig memory cfg = configs[i];

            MezRangeStrategy strategy = new MezRangeStrategy(
                posManager, cfg.pool, swapRouter, cfg.strategyType, deployer
            );
            MezRangeVault vault = new MezRangeVault(
                cfg.token0, address(strategy), treasury, deployer, cfg.name, cfg.symbol
            );

            strategy.grantRole(strategy.VAULT_ROLE(),  address(vault));
            strategy.grantRole(strategy.KEEPER_ROLE(), keeper);
            vault.grantRole(vault.KEEPER_ROLE(), keeper);

            console.log("--- Vault:", cfg.name, "---");
            console.log("  Strategy:", address(strategy));
            console.log("  Vault:   ", address(vault));
        }

        vm.stopBroadcast();
    }
}
