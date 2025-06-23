import { createPublicClient, http, Chain, PublicClient, Address, erc20Abi } from 'viem';
import { mainnet, sepolia, bsc, bscTestnet } from 'viem/chains';
import { FeeAmount, FACTORY_ADDRESS, ADDRESS_ZERO, Pool as V3Pool } from '@uniswap/v3-sdk';
import { Token as V3Token } from '@uniswap/sdk-core';

import { FACTORY_ABI, POOL_ABI } from './abi';

type Token = { address: Address; name: string; symbol: string; decimals: number };
type Pool = {
  address: Address;
  fee: number;
  wrappedReservesRaw: bigint;
  tokenReservesRaw: bigint;
  wrappedReserves: number;
  tokenReserves: number;
  liquidity?: bigint;
  price?: string;
  priceUSD?: number;
  tvl?: number;
};

const FACTORY: Record<number, Address> = {
  [mainnet.id]: FACTORY_ADDRESS,
  [sepolia.id]: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
  [bsc.id]: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
  [bscTestnet.id]: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
};

const WRAPPED_NATIVE_CURRENCY: Record<number, Token> = {
  [mainnet.id]: {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
  },
  [sepolia.id]: {
    address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
  },
  [bsc.id]: {
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    name: 'Wrapped BNB',
    symbol: 'WBNB',
    decimals: 18,
  },
  [bscTestnet.id]: {
    address: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    name: 'Wrapped BNB',
    symbol: 'WBNB',
    decimals: 18,
  },
};

const FEE_TIERS = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH];

function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

class UniswapV3Pool {
  readonly chain: Chain;
  readonly wrappedToken: Token;
  readonly client: PublicClient;
  token: Token = {} as Token;

  constructor(chain: Chain) {
    this.chain = chain;
    this.wrappedToken = WRAPPED_NATIVE_CURRENCY[chain.id];
    this.client = createPublicClient({
      chain,
      transport: http(),
    });
  }

  /**
   * Fetches the current USD price of the native token for the configured chain
   * using the CoinGecko API.
   *
   * - If the chain is Ethereum mainnet or Sepolia, it fetches the price of ETH.
   * - Otherwise, it fetches the price of BNB (assumed to be for Binance Smart Chain).
   *
   * @returns A promise that resolves to the native token price in USD.
   */
  private async fetchNativePrice(): Promise<number> {
    const id =
      this.chain.id === mainnet.id || this.chain.id === sepolia.id ? 'ethereum' : 'binancecoin';
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    const data = await res.json();
    return data[id].usd;
  }

  /**
   * Fetches metadata (name, symbol, decimals) for an ERC-20 token using multicall.
   *
   * This method performs a batch call to get the token name, symbol, and decimals
   * from the provided token contract address.
   *
   * @param tokenAddress - The address of the ERC-20 token.
   * @returns A promise that resolves to a `Token` object containing:
   *          - address: the token's contract address
   *          - name: the token's name (e.g., "USD Coin")
   *          - symbol: the token's symbol (e.g., "USDC")
   *          - decimals: the number of decimals the token uses (e.g., 6)
   */
  private async getToken(tokenAddress: Address): Promise<Token> {
    const tokenData = await this.client.multicall({
      contracts: [
        {
          abi: erc20Abi,
          functionName: 'name',
          address: tokenAddress,
        },
        {
          abi: erc20Abi,
          functionName: 'symbol',
          address: tokenAddress,
        },
        {
          abi: erc20Abi,
          functionName: 'decimals',
          address: tokenAddress,
        },
      ],
    });

    return {
      address: tokenAddress,
      name: tokenData[0].result as string,
      symbol: tokenData[1].result as string,
      decimals: tokenData[2].result as number,
    };
  }

  /**
   * Orders two tokens by their address to ensure a consistent token pair ordering.
   *
   * This is commonly used for creating or interacting with deterministic pool addresses,
   * where token0 must be the lower-address token and token1 the higher-address token.
   *
   * @returns A tuple `[token0, token1]` where `token0.address < token1.address`
   */
  private async orderTokens(): Promise<[Token, Token]> {
    return this.token.address > this.wrappedToken.address
      ? [this.wrappedToken, this.token]
      : [this.token, this.wrappedToken];
  }

  /**
   * Retrieves available Uniswap V3 pool addresses for a token pair across multiple fee tiers.
   *
   * This function:
   *  - Orders the tokens to match Uniswap's expected token order
   *  - Queries the Uniswap V3 factory for each fee tier using `getPool(token0, token1, fee)`
   *  - Filters out any zero-address (non-existent) pools
   *
   * @returns A list of pools with their `address` and `fee` for the token pair.
   */
  private async poolAddresses(): Promise<Array<Pick<Pool, 'address' | 'fee'>>> {
    const [baseToken, quoteToken] = await this.orderTokens();

    const contracts = FEE_TIERS.map(fee => ({
      abi: FACTORY_ABI,
      address: FACTORY[this.chain.id],
      functionName: 'getPool',
      args: [baseToken.address, quoteToken.address, fee],
    }));

    const pools = (
      await this.client.multicall({
        contracts: contracts as any,
      })
    ).reduce<Array<Pick<Pool, 'address' | 'fee'>>>((acc, item, index) => {
      if (item.status === 'success' && item.result !== ADDRESS_ZERO) {
        acc.push({
          address: item.result as Address,
          fee: FEE_TIERS[index],
        });
      }
      return acc;
    }, []);

    return pools;
  }

  /**
   * Fetches reserve balances of `token` and `wrappedToken` for each provided Uniswap V3 pool.
   *
   * It uses ERC-20 `balanceOf(poolAddress)` calls to determine the raw and human-readable
   * reserves of each token in the pool.
   *
   * @param pools - Array of pool objects containing `address` and `fee`.
   * @returns Array of extended Pool objects containing both raw and normalized reserves.
   */
  private async poolsReserves(pools: Array<Pick<Pool, 'address' | 'fee'>>): Promise<Array<Pool>> {
    const contracts = pools.flatMap(pool => [
      {
        abi: erc20Abi,
        functionName: 'balanceOf',
        address: this.wrappedToken.address,
        args: [pool.address],
      },
      {
        abi: erc20Abi,
        functionName: 'balanceOf',
        address: this.token.address,
        args: [pool.address],
      },
    ]);

    const result = await this.client.multicall({
      contracts: contracts,
    });

    const poolData = chunkArray(result, 2).reduce<Array<Pool>>(
      (accum, [wrappedReserves, tokenReserves], index) => {
        const pool = pools[index];
        accum.push({
          address: pool.address,
          fee: pool.fee,
          wrappedReservesRaw: wrappedReserves.result as bigint,
          tokenReservesRaw: tokenReserves.result as bigint,
          wrappedReserves: Number(wrappedReserves.result) / 10 ** this.wrappedToken.decimals,
          tokenReserves: Number(tokenReserves.result) / 10 ** this.token.decimals,
        });
        return accum;
      },
      []
    );

    return poolData;
  }

  /**
   * Enriches each Uniswap V3 pool with pricing information:
   * - Fetches `liquidity` and `slot0` (includes sqrtPriceX96, tick) via multicall
   * - Constructs a V3Pool object from Uniswap SDK
   * - Computes token price in wrapped token and in USD
   * - Computes pool TVL using token and wrapped token reserves
   *
   * @param pools - Array of partially populated Pool objects
   * @returns Array of Pool objects with price, priceUSD, and TVL added
   */
  private async poolPricing(pools: Array<Pool>): Promise<Array<Pool>> {
    const contracts = pools.flatMap(pool => [
      {
        abi: POOL_ABI,
        functionName: 'liquidity',
        address: pool.address,
      },
      {
        abi: POOL_ABI,
        functionName: 'slot0',
        address: pool.address,
      },
    ]);

    const result = await this.client.multicall({
      contracts,
    });

    const nativePrice = await this.fetchNativePrice();

    const poolData = chunkArray(result, 2).reduce<Array<Pool>>(
      (accum, [liquidity, slot0], index) => {
        let pool = pools[index];
        pool['liquidity'] = liquidity.result as bigint;

        if (slot0.result === undefined || typeof slot0.result === 'bigint') {
          throw Error('Slot0 type error');
        }

        const v3Pool = new V3Pool(
          new V3Token(this.chain.id, this.token.address, this.token.decimals),
          new V3Token(this.chain.id, this.wrappedToken.address, this.wrappedToken.decimals),
          pool.fee,
          slot0.result[0].toString(), //sqrtPriceX96
          pool.liquidity.toString(),
          slot0.result[1] //tick
        );

        const tokenPerWrapped = v3Pool.token0Price.toSignificant(6);
        pool['price'] = tokenPerWrapped;

        const priceUSD = parseFloat(tokenPerWrapped) * nativePrice;
        pool['priceUSD'] = priceUSD;
        pool['tvl'] = priceUSD * pool.tokenReserves + nativePrice * pool.wrappedReserves;
        accum.push(pool);
        return accum;
      },
      []
    );

    return poolData;
  }

  /**
   * Fetches and prints detailed Uniswap V3 pool information for a given token.
   *
   * This includes:
   *  - Fetching token metadata (name, symbol, decimals)
   *  - Discovering all available pools with the native wrapped token (e.g., WETH/BNB)
   *  - Fetching reserve balances from each pool
   *  - Enriching pools with pricing and TVL data
   *
   * @param tokenAddress - The address of the ERC-20 token to analyze.
   */
  async getPools(tokenAddress: Address) {
    this.token = await this.getToken(tokenAddress);
    const addresses = await this.poolAddresses();
    const reserves = await this.poolsReserves(addresses);
    const poolData = await this.poolPricing(reserves);
    console.dir(poolData, { depth: null });
  }
}

// new UniswapV3Pool(mainnet).getPools('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984');
new UniswapV3Pool(sepolia).getPools('0xb6ea753c0add44c29fc63b3b31b15f2787d8c2b5');
