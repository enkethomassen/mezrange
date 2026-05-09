import { ethers } from 'ethers';
import { DEPLOYED_CONTRACTS } from '../src/data/deployedContracts';

type VaultKey = 'btcMusd' | 'mezoMusd' | 'btcMezo';

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.test.mezo.org';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const VAULT_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function strategy() view returns (address)',
  'function depositWithMinShares(uint256,uint256) returns (uint256)',
];

const STRATEGY_ABI = [
  'function positionActive() view returns (bool)',
  'function currentTickLower() view returns (int24)',
  'function currentTickUpper() view returns (int24)',
  'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
];

const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function observations(uint256) view returns (uint32,int56,uint160,bool)',
  'function observe(uint32[]) view returns (int56[],uint160[])',
];

function getArg(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function format(value: bigint, decimals = 18): string {
  return ethers.formatUnits(value, decimals);
}

function parseVaultKey(raw: string | undefined): VaultKey {
  if (!raw) return 'btcMusd';
  if (raw === 'btcMusd' || raw === 'mezoMusd' || raw === 'btcMezo') return raw;
  throw new Error(`Unsupported vault key: ${raw}`);
}

function decodeRevert(error: unknown): string {
  if (ethers.isError(error, 'CALL_EXCEPTION')) {
    if (error.reason) return error.reason;
    if (error.data) return `CALL_EXCEPTION data=${error.data}`;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

async function safeReadSlot0(poolAddress: string, provider: ethers.Provider) {
  const iface = new ethers.Interface([
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  ]);

  try {
    const data = await provider.call({
      to: poolAddress,
      data: iface.encodeFunctionData('slot0'),
    });
    const decoded = iface.decodeFunctionResult('slot0', data);
    return {
      ok: true as const,
      sqrtPriceX96: decoded[0].toString(),
      tick: decoded[1].toString(),
      raw: data,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: decodeRevert(error),
    };
  }
}

async function main() {
  const vaultKey = parseVaultKey(getArg('vault'));
  const from = getArg('from');
  const amountHuman = getArg('amount') ?? '50';
  const txHash = getArg('tx');

  if (!from) {
    throw new Error('Missing --from <wallet>');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const config = DEPLOYED_CONTRACTS.testnet.vaults[vaultKey];

  const vault = new ethers.Contract(config.vault, VAULT_ABI, provider);
  const strategy = new ethers.Contract(config.strategy, STRATEGY_ABI, provider);
  const pool = new ethers.Contract(config.pool, POOL_ABI, provider);
  const token = new ethers.Contract(config.token0, ERC20_ABI, provider);

  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals(),
  ]);

  const amount = ethers.parseUnits(amountHuman, decimals);

  console.log('Deposit Diagnostics');
  console.log(`RPC:         ${RPC_URL}`);
  console.log(`Vault key:   ${vaultKey}`);
  console.log(`From:        ${from}`);
  console.log(`Amount:      ${amountHuman} ${symbol}`);
  console.log(`Vault:       ${config.vault}`);
  console.log(`Strategy:    ${config.strategy}`);
  console.log(`Pool:        ${config.pool}`);
  console.log(`Token0:      ${config.token0}`);
  console.log(`Token1:      ${config.token1}`);
  console.log('');

  const [
    assetAddr,
    totalAssets,
    totalSupply,
    tokenBalance,
    allowance,
    previewShares,
    positionActive,
    currentTickLower,
    currentTickUpper,
    strategyFee,
    strategyTickSpacing,
    poolToken0,
    poolToken1,
    poolFee,
    poolLiquidity,
    observation0,
  ] = await Promise.all([
    vault.asset(),
    vault.totalAssets(),
    vault.totalSupply(),
    token.balanceOf(from),
    token.allowance(from, config.vault),
    vault.previewDeposit(amount),
    strategy.positionActive(),
    strategy.currentTickLower(),
    strategy.currentTickUpper(),
    strategy.fee(),
    strategy.tickSpacing(),
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
    pool.observations(0),
  ]);
  const slot0 = await safeReadSlot0(config.pool, provider);

  console.log('Vault State');
  console.log(`asset():              ${assetAddr}`);
  console.log(`totalAssets():        ${format(totalAssets, decimals)} ${symbol}`);
  console.log(`totalSupply():        ${format(totalSupply, decimals)} shares`);
  console.log(`previewDeposit():     ${format(previewShares, decimals)} shares`);
  console.log('');

  console.log('Wallet Checks');
  console.log(`token balance:        ${format(tokenBalance, decimals)} ${symbol}`);
  console.log(`allowance to vault:   ${format(allowance, decimals)} ${symbol}`);
  console.log(`balance sufficient:   ${tokenBalance >= amount}`);
  console.log(`allowance sufficient: ${allowance >= amount}`);
  console.log('');

  console.log('Strategy State');
  console.log(`positionActive():     ${positionActive}`);
  console.log(`currentTickLower():   ${currentTickLower}`);
  console.log(`currentTickUpper():   ${currentTickUpper}`);
  console.log(`fee():                ${strategyFee}`);
  console.log(`tickSpacing():        ${strategyTickSpacing}`);
  console.log('');

  console.log('Pool State');
  console.log(`token0():             ${poolToken0}`);
  console.log(`token1():             ${poolToken1}`);
  console.log(`fee():                ${poolFee}`);
  console.log(`liquidity():          ${poolLiquidity}`);
  if (slot0.ok) {
    console.log(`slot0.tick:           ${slot0.tick}`);
    console.log(`slot0.sqrtPriceX96:   ${slot0.sqrtPriceX96}`);
  } else {
    console.log(`slot0():              REVERT/DECODE ${slot0.error}`);
  }
  console.log(`observation[0]:       ts=${observation0[0]} initialized=${observation0[3]}`);

  try {
    const observeResult = await pool.observe([300, 0]);
    console.log(`observe([300,0]):     ticks=${observeResult[0].join(', ')}`);
  } catch (error) {
    console.log(`observe([300,0]):     REVERT ${decodeRevert(error)}`);
  }
  console.log('');

  const minShares = (previewShares * 99n) / 100n;
  console.log('Simulation');
  console.log(`minShares (1% slack): ${format(minShares, decimals)} shares`);
  try {
    await vault.depositWithMinShares.staticCall(amount, minShares, { from });
    console.log('depositWithMinShares: SUCCESS');
  } catch (error) {
    console.log(`depositWithMinShares: REVERT ${decodeRevert(error)}`);
    console.log('Likely cause: internal strategy swap or first-position mint path is failing.');
  }

  try {
    const gas = await vault.depositWithMinShares.estimateGas(amount, minShares, { from });
    console.log(`estimateGas():        ${gas}`);
  } catch (error) {
    console.log(`estimateGas():        REVERT ${decodeRevert(error)}`);
  }
  console.log('');

  if (txHash) {
    console.log('Failed Transaction');
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]);

    console.log(`hash:                 ${txHash}`);
    console.log(`from:                 ${tx?.from ?? 'n/a'}`);
    console.log(`to:                   ${tx?.to ?? 'n/a'}`);
    console.log(`gasLimit:             ${tx?.gasLimit?.toString() ?? 'n/a'}`);
    console.log(`status:               ${receipt?.status ?? 'n/a'}`);
    console.log(`gasUsed:              ${receipt?.gasUsed?.toString() ?? 'n/a'}`);
    console.log(`logs:                 ${receipt?.logs.length ?? 0}`);
  }
}

main().catch((error) => {
  console.error('Deposit diagnostics failed:', error);
  process.exit(1);
});
