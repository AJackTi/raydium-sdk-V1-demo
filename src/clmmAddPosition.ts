import assert from 'assert';

import {
  Clmm,
  ApiClmmPoolsItem,
  ENDPOINT,
  fetchMultipleMintInfos,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';

import {
  connection,
  DEFAULT_TOKEN,
  makeTxVersion,
  RAYDIUM_MAINNET_API,
  wallet,
} from '../config';
import {
  buildAndSendTx,
  getWalletTokenAccount,
} from './util';
import Decimal from 'decimal.js';
import { BN } from 'bn.js';
import { _d } from './getOutOfRangePositionOutAmount';

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>
type TestTxInputInfo = {
  targetPool: string
  inputTokenAmount: Decimal
  inputTokenMint: 'mintA' | 'mintB'
  walletTokenAccounts: WalletTokenAccounts
  wallet: Keypair
  slippage: number

  positionMint: PublicKey
}

/**
 * pre-action: fetch basic Clmm info
 *
 * step 1: Clmm info and Clmm position
 * step 2: calculate liquidity
 * step 3: create instructions by SDK function
 * step 4: compose instructions to several transactions
 * step 5: send transactions
 */
async function clmmAddPosition({ targetPool, inputTokenAmount, inputTokenMint, wallet, walletTokenAccounts, slippage, positionMint}: TestTxInputInfo): Promise<{ txids: string[] }> {
  // -------- pre-action: fetch basic info --------
  const clmmPools = (await fetch(ENDPOINT + RAYDIUM_MAINNET_API.clmmPools).then((res) => res.json())).data
  const clmmPool = clmmPools.find((pool: ApiClmmPoolsItem) => pool.id === targetPool)

  // -------- step 1: Clmm info and Clmm position --------
  const { [clmmPool.id]: { state: poolInfo, positionAccount } } = await Clmm.fetchMultiplePoolInfos({
    connection,
    poolKeys: [clmmPool],
    chainTime: new Date().getTime() / 1000,
    ownerInfo: {
      wallet: wallet.publicKey,
      tokenAccounts: walletTokenAccounts,
    },
  })
  assert(positionAccount && positionAccount.length, "position is not exist/is empty, so can't continue to add position")
  const clmmPosition = positionAccount.find(i => i.nftMint.equals(positionMint)) // assume first one is your target
  if (clmmPosition === undefined) throw Error('not found position')

  // -------- step 2: calculate liquidity --------
  const { liquidity, amountSlippageA, amountSlippageB } = Clmm.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: 0,
    inputA: inputTokenMint === 'mintA',
    tickUpper: clmmPosition.tickUpper,
    tickLower: clmmPosition.tickLower,
    amount: new BN(inputTokenAmount.mul(10 ** poolInfo[inputTokenMint].decimals).toFixed(0)),
    add: true, // SDK flag for math round direction
    amountHasFee: true,
    token2022Infos: await fetchMultipleMintInfos({ connection, mints: [poolInfo.mintA.mint, poolInfo.mintB.mint]}),
    epochInfo: await connection.getEpochInfo()
  })
  console.log(`will add liquidity -> ${liquidity.toString()} - amount A -> ${_d(poolInfo, amountSlippageA.amount, 'A')} - amount B -> ${_d(poolInfo, amountSlippageB.amount, 'B')}`)

  // -------- step 3: create instructions by SDK function --------
  const makeIncreaseLiquidityInstruction = await Clmm.makeIncreasePositionFromLiquidityInstructionSimple({
    connection,
    poolInfo,
    ownerPosition: clmmPosition,
    ownerInfo: {
      feePayer: wallet.publicKey,
      wallet: wallet.publicKey,
      tokenAccounts: walletTokenAccounts,
    },
    liquidity,
    makeTxVersion,
    amountMaxA: amountSlippageA.amount,
    amountMaxB: amountSlippageB.amount,
  })

  return { txids: await buildAndSendTx(makeIncreaseLiquidityInstruction.innerTransactions) }
}

async function howToUse() {
  const targetPool = '61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht' // RAY-USDC pool
  const inputTokenAmount = new Decimal(1)
  const inputTokenMint: 'mintA' | 'mintB' = 'mintA'
  const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey)
  const slippage = 0.01
  const positionMint = new PublicKey('')

  clmmAddPosition({
    targetPool,
    inputTokenAmount,
    inputTokenMint,
    walletTokenAccounts,
    wallet,
    slippage,

    positionMint,
  }).then(({ txids }) => {
    /** continue with txids */
    console.log('txids', txids)
  })
}
