const { ethers } = await import('ethers').then(m=>m);

const RPC = 'https://rpc.test.mezo.org';
const VAULT = '0xd4eCCd598239Be39492370e2F3f048A5C3723D41';
const STRATEGY = '0x439f267A6C924138a8950202C1778D222412f8Ac';
const POOL = '0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850';
const MUSD = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';

const provider = new ethers.JsonRpcProvider(RPC);

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function asset() view returns (address)',
  'function paused() view returns (bool)',
  'function strategy() view returns (address)',
  'function previewDeposit(uint256) view returns (uint256)',
];
const STRAT_ABI = [
  'function positionActive() view returns (bool)',
  'function currentTickLower() view returns (int24)',
  'function currentTickUpper() view returns (int24)',
  'function shouldRebalance() view returns (bool)',
  'function rebalanceCount() view returns (uint256)',
  'function totalValue() view returns (uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function slippageBps() view returns (uint256)',
  'function twapSeconds() view returns (uint32)',
  'function positionTokenId() view returns (uint256)',
  'function hasRole(bytes32, address) view returns (bool)',
];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

async function main() {
  const vault = new ethers.Contract(VAULT, VAULT_ABI, provider);
  const strat = new ethers.Contract(STRATEGY, STRAT_ABI, provider);
  const pool = new ethers.Contract(POOL, POOL_ABI, provider);
  const musd = new ethers.Contract(MUSD, ERC20_ABI, provider);

  console.log('=== Chain connection ===');
  const block = await provider.getBlockNumber();
  console.log('Block:', block);

  console.log('\n=== Vault state ===');
  const [totalAssets, totalSupply, paused, assetAddr] = await Promise.all([
    vault.totalAssets(),
    vault.totalSupply(),
    vault.paused(),
    vault.asset(),
  ]);
  console.log('totalAssets:', ethers.formatUnits(totalAssets, 18), 'MUSD');
  console.log('totalSupply:', ethers.formatUnits(totalSupply, 18), 'shares');
  console.log('paused:', paused);
  console.log('asset:', assetAddr);

  const preview100 = await vault.previewDeposit(ethers.parseUnits('100', 18));
  console.log('previewDeposit(100 MUSD):', ethers.formatUnits(preview100, 18), 'shares');

  console.log('\n=== Strategy state ===');
  const [posActive, tickLower, tickUpper, shouldRebal, rebalCount, tv, token0, token1, slipBps, twap, tokenId] = await Promise.all([
    strat.positionActive(),
    strat.currentTickLower(),
    strat.currentTickUpper(),
    strat.shouldRebalance(),
    strat.rebalanceCount(),
    strat.totalValue(),
    strat.token0(),
    strat.token1(),
    strat.slippageBps(),
    strat.twapSeconds(),
    strat.positionTokenId(),
  ]);
  console.log('positionActive:', posActive);
  console.log('currentTickLower:', tickLower.toString());
  console.log('currentTickUpper:', tickUpper.toString());
  console.log('shouldRebalance:', shouldRebal);
  console.log('rebalanceCount:', rebalCount.toString());
  console.log('totalValue:', ethers.formatUnits(tv, 18), 'MUSD');
  console.log('token0:', token0);
  console.log('token1:', token1);
  console.log('slippageBps:', slipBps.toString());
  console.log('twapSeconds:', twap.toString());
  console.log('positionTokenId:', tokenId.toString());

  // Check VAULT_ROLE on strategy
  const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('VAULT_ROLE'));
  const hasVaultRole = await strat.hasRole(VAULT_ROLE, VAULT);
  console.log('\nVAULT has VAULT_ROLE on strategy:', hasVaultRole);

  console.log('\n=== Pool state ===');
  const [slot0, poolToken0, poolToken1, poolLiq] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.token1(),
    pool.liquidity(),
  ]);
  console.log('slot0.sqrtPriceX96:', slot0.sqrtPriceX96.toString());
  console.log('slot0.tick:', slot0.tick.toString());
  console.log('pool.token0:', poolToken0);
  console.log('pool.token1:', poolToken1);
  console.log('pool.liquidity:', poolLiq.toString());

  console.log('\n=== Balances ===');
  const [vaultMusd, stratMusd] = await Promise.all([
    musd.balanceOf(VAULT),
    musd.balanceOf(STRATEGY),
  ]);
  console.log('Vault MUSD balance:', ethers.formatUnits(vaultMusd, 18));
  console.log('Strategy MUSD balance:', ethers.formatUnits(stratMusd, 18));

  // Try to simulate a deposit call to see what revert we get
  console.log('\n=== Deposit simulation ===');
  // The vault calls strategy.addLiquidity — let's try to understand why it might fail
  // Check if the pool's token ordering matches strategy token0/token1
  console.log('Pool token0 == MUSD?', poolToken0.toLowerCase() === MUSD.toLowerCase());
  console.log('Strategy token0 == MUSD?', token0.toLowerCase() === MUSD.toLowerCase());

  // Check the TWAP — does pool have observation history?
  try {
    const POOL_FULL = new ethers.Contract(POOL, [
      'function observe(uint32[]) view returns (int56[], uint160[])',
      'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
      'function observations(uint256) view returns (uint32,int56,uint160,bool)',
    ], provider);
    const obs = await POOL_FULL.observe([300, 0]);
    const tickDelta = obs[0][1] - obs[0][0];
    const twapTick = tickDelta / BigInt(300);
    console.log('\nTWAP tick (5min):', twapTick.toString());
    console.log('Spot tick:', slot0.tick.toString());
  } catch (e) {
    console.log('\npool.observe() FAILED:', e.message);
    console.log('=> Pool has insufficient TWAP history — addLiquidity uses spot tick fallback');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
