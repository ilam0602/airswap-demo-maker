import WebSocket from 'ws'
import { ethers } from 'ethers'
import { orderToParams } from '@airswap/utils'
import { etherscanDomains } from '@airswap/constants'
import { Swap } from "@airswap/libraries";

import * as SwapContract from '@airswap/swap/build/contracts/Swap.sol/Swap.json'
// TODO: type defs for this.
// @ts-ignore
import * as swapDeploys from '@airswap/swap/deploys.js'

const start = function (config: any) {
  const wss = new WebSocket.Server({ server: config.server })
  const subscribers: WebSocket[] = []

  function removeSubscriber(subscriber: WebSocket) {
    const idx = subscribers.findIndex((ws: WebSocket) => { if (ws === subscriber) return true })
    subscribers.splice(idx, 1)
  }

  setInterval(() => {
    for (let idx in subscribers) {
      subscribers[idx].send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'updatePricing',
        params: [config.levels.LLLevels],
      }))
    }
  }, 1000)

  wss.on('connection', (ws: any, req: any) => {
    ws.on('message', async (message: any) => {
      let json: any
      try {
        json = JSON.parse(message)
      } catch (e) {
        console.log('Failed to parse JSON-RPC message', message)
        return
      }
      switch (json.method) {
        case 'subscribe':
        case 'subscribeAll':
          subscribers.push(ws)
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: config.levels.LLLevels
          }))
          break
        case 'unsubscribe':
        case 'unsubscribeAll':
          removeSubscriber(ws)
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: true
          }))
          break
        case 'consider':
          console.log('Checking...', json.params)
          const errors = (await new Swap(config.chainId).check(
            json.params,
            config.wallet.address,
            config.wallet
          ))
          if (!errors.length) {
            console.log('No errors; taking...', `(gas price ${config.gasPrice})`)
            new ethers.Contract(swapDeploys[config.chainId], SwapContract.abi, config.wallet)
              .light(...orderToParams(json.params), { gasPrice: config.gasPrice })
              .then((tx: any) => {
                ws.send(JSON.stringify({
                  jsonrpc: '2.0',
                  id: json.id,
                  result: true
                }))
                console.log('Submitted...', `https://${etherscanDomains[tx.chainId]}/tx/${tx.hash}`)
                tx.wait(config.confirmations).then(() => {
                  console.log('Mined ✨', `https://${etherscanDomains[tx.chainId]}/tx/${tx.hash}`)
                })
              })
              .catch((error: any) => {
                ws.send(JSON.stringify({
                  jsonrpc: '2.0',
                  id: json.id,
                  error: error.message
                }))
                console.log(error.message)
              })
          } else {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              error: errors
            }))
            console.log('Errors taking...', errors)
          }
          break
      }
    })
    ws.on('close', () => {
      removeSubscriber(ws)
    })
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: [[{
        name: 'last-look',
        version: '1.0.0',
        params: {
          senderWallet: config.wallet.address,
          swapContract: swapDeploys[config.chainId],
        },
      }]]
    }))
    console.log('Connection', req.socket.remoteAddress)
  })
}

export default start
