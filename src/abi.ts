export const FACTORY_ABI = [
  {
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
      { name: '', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const POOL_ABI = [
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'int24', name: '', type: 'int24' }],
    name: 'ticks',
    outputs: [
      { internalType: 'uint128', name: 'liquidityGross', type: 'uint128' },
      { internalType: 'int128', name: 'liquidityNet', type: 'int128' },
      { internalType: 'uint256', name: 'feeGrowthOutside0X128', type: 'uint256' },
      { internalType: 'uint256', name: 'feeGrowthOutside1X128', type: 'uint256' },
      { internalType: 'int56', name: 'tickCumulativeOutside', type: 'int56' },
      { internalType: 'uint160', name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { internalType: 'uint32', name: 'secondsOutside', type: 'uint32' },
      { internalType: 'bool', name: 'initialized', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
