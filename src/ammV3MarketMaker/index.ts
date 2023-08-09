import {
  AmmV3,
  ApiAmmV3PoolsItem,
  ReturnTypeFetchMultiplePoolInfos,
  TokenAccount,
  TxVersion,
} from '@raydium-io/raydium-sdk'
import { Connection, Keypair } from '@solana/web3.js'

import cron from 'node-cron'
import axios from 'axios'

import { getUserTokenAccounts, TokenAccountInfo } from './tokenAccount'
import { createPositionTx, closePositionTx } from './ammV3Tx'
import bs58 from 'bs58'
import BN from 'bn.js'

// all ammv3 pools: https://api.raydium.io/v2/ammV3/ammPools
// SOL-USDC pool id 2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv

const commitment = 'confirmed'
const poolId = process.argv[2]
const createDeviation = !isNaN(Number(process.argv[3])) ? Number(process.argv[3]) : 10
const closeDeviation = !isNaN(Number(process.argv[4])) ? Number(process.argv[4]) : 5
const connection = new Connection('rpc node url', commitment)

const owner = Keypair.fromSecretKey(bs58.decode(`your secret key here`))

let cachedPools: ApiAmmV3PoolsItem[] = []

let accounts: TokenAccountInfo[] = []
let accountsRawInfo: TokenAccount[] = []
let accountListenerId: number | undefined

async function getPoolInfo(poolId: string): Promise<ReturnTypeFetchMultiplePoolInfos> {
  if (!poolId) return {}
  if (!cachedPools.length) {
    const { data } = await axios.get<{ data: ApiAmmV3PoolsItem[] }>('https://api.raydium.io/v2/ammV3/ammPools')
    cachedPools = data.data
  }

  const { data } = await axios.get<{ chainTime: number; offset: number }>('https://api.raydium.io/v2/main/chain/time')

  const pool = cachedPools.find((p) => p.id === poolId)
  if (pool) {
    return await AmmV3.fetchMultiplePoolInfos({
      poolKeys: [pool],
      connection,
      ownerInfo: { tokenAccounts: accountsRawInfo, wallet: owner.publicKey },
      chainTime: (Date.now() + (data.offset || 0 * 1000)) / 1000,
      batchRequest: true,
    })
  }

  return {}
}

async function checkPosition() {
  if (!poolId) {
    console.log('please provide pool id')
    return
  }
  if (!accounts.length) {
    const fetchFuc = async () => {
      const accountRes = await getUserTokenAccounts({
        connection,
        commitment,
        owner: owner.publicKey,
      })
      accounts = [...accountRes.accounts]
      accountsRawInfo = [...accountRes.accountsRawInfo]
    }
    await fetchFuc()

    if (accountListenerId) {
      connection.removeAccountChangeListener(accountListenerId)
      accountListenerId = undefined
    }
    accountListenerId = connection.onAccountChange(owner.publicKey, fetchFuc)
  }

  const res = await getPoolInfo(poolId)
  const parsedPool = res[poolId]
  if (parsedPool) {
    console.log(`\nConcentrated pool: ${poolId}`)
    console.log(`\nclose deviation setting: ${closeDeviation}%, create deviation setting: ${createDeviation}%`)
    const currentPrice = parsedPool.state.currentPrice
    parsedPool.positionAccount?.forEach(async (position, idx) => {
      const { priceLower, priceUpper } = position
      console.log(
        `\n===== position ${idx + 1} =====\n`,
        `current price: ${currentPrice}\n`,
        `priceLower: ${priceLower.toString()}\n`,
        `priceUpper: ${priceUpper.toString()}`
      )
      const currentPositionMid = priceLower.add(priceUpper).div(2)
      const [closeLow, closeUp] = [
        currentPrice.mul((100 - closeDeviation) / 100),
        currentPrice.mul((100 + closeDeviation) / 100),
      ]

      if (currentPositionMid < closeLow || currentPositionMid > closeUp) {
        console.log('\n⛔ close position triggered!')
        console.log(`closeLower:${closeLow}\ncurrentPosition:${currentPositionMid}\ncloseUpper: ${closeUp}`)
        /* close position here */
        // await closePositionTx({
        //   connection,
        //   poolInfo: parsedPool.state,
        //   position,
        //   owner,
        //   tokenAccounts: accountsRawInfo,
        // });

        const [recreateLower, recreateUpper] = [
          currentPrice.mul((100 - createDeviation) / 100),
          currentPrice.mul((100 + createDeviation) / 100),
        ]
        console.log('\n ✅ create new position')
        console.log(`priceLower:${recreateLower}\npriceUpper: ${recreateUpper}`)
        /* create position here */
        // await createPositionTx({
        //   connection,
        //   poolInfo: parsedPool.state,
        //   priceLower,
        //   priceUpper,
        //   owner,
        //   tokenAccounts: accountsRawInfo,
        //   amountA: new BN(10000),
        // });
        return
      }
      console.log('position in range, no action needed')
    })
  }
}

const job = cron.schedule('*/1 * * * *', checkPosition, {
  scheduled: false,
})

if (poolId) {
  checkPosition()
  job.start()
} else {
  console.log('please provide pool id')
}