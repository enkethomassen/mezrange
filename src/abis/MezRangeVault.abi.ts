/**
 * ABI fragments for MezRangeVault (ERC-4626).
 * Only the functions needed by the frontend are included.
 */
export const VAULT_ABI = [
  // ERC-4626 views
  { name: 'totalAssets',     type: 'function', stateMutability: 'view',       inputs: [],                                                                      outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply',     type: 'function', stateMutability: 'view',       inputs: [],                                                                      outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',       type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }],                                  outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view',       inputs: [{ name: 'shares', type: 'uint256' }],                                   outputs: [{ type: 'uint256' }] },
  { name: 'previewDeposit',  type: 'function', stateMutability: 'view',       inputs: [{ name: 'assets', type: 'uint256' }],                                   outputs: [{ type: 'uint256' }] },
  { name: 'previewRedeem',   type: 'function', stateMutability: 'view',       inputs: [{ name: 'shares', type: 'uint256' }],                                   outputs: [{ type: 'uint256' }] },
  { name: 'maxWithdraw',     type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }],                                    outputs: [{ type: 'uint256' }] },
  { name: 'asset',           type: 'function', stateMutability: 'view',       inputs: [],                                                                      outputs: [{ type: 'address' }] },
  { name: 'performanceFeeBps', type: 'function', stateMutability: 'view',     inputs: [],                                                                      outputs: [{ type: 'uint256' }] },
  { name: 'managementFeeBps',  type: 'function', stateMutability: 'view',     inputs: [],                                                                      outputs: [{ type: 'uint256' }] },
  // State-changing
  { name: 'depositWithMinShares', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'minShares', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { name: 'redeemWithMinAssets',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'minAssets', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  // Events
  { name: 'Deposit', type: 'event', inputs: [{ name: 'sender', type: 'address', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }] },
  { name: 'Withdraw', type: 'event', inputs: [{ name: 'sender', type: 'address', indexed: true }, { name: 'receiver', type: 'address', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }] },
] as const;
