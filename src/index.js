/* eslint-env browser */
import * as Link from 'multiformats/link'
import Queue from 'p-queue'
import all from 'p-all'
import { Client } from './client.js'

/** @typedef {{ message: import('@cloudflare/workers-types').Message<import('./bindings').Body>, indexData: import('./bindings').BlockIndexData }} BatchItem */

const BATCH_SIZE = 100

export default {
  /**
   * @param {Request} request
   * @param {import('./bindings').Environment} env
   */
  async fetch (request, env) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }
    const reqURL = new URL(request.url)
    if (!(reqURL.pathname.startsWith('/send') || reqURL.pathname.startsWith('/process'))) {
      return new Response('not found', { status: 404 })
    }
    const message = await request.json()
    try {
      decodeMessageBody(message)
    } catch (err) {
      console.warn(err)
      return new Response(`invalid message: ${err.message}`, { status: 400 })
    }
    try {
      if (reqURL.pathname.startsWith('/send')) {
        await env.GENDEX_QUEUE.send(message)
      } else {
        const client = new Client(new URL(env.GENDEX_API_URL), env.GENDEX_SERVICE ?? globalThis)
        const messages = [
          decodeMessage({
            id: Date.now().toString(),
            timestamp: new Date(),
            body: message,
            ack: () => {},
            retry: () => {}
          })
        ]
        await processBatch(client, messages)
      }
    } catch (err) {
      console.error(err)
      return new Response(`failed to queue message: ${env.DEBUG ? err.stack : err.message}`, { status: 500 })
    }
    return new Response('send success 👍')
  },
  /**
   * @param {import('@cloudflare/workers-types').MessageBatch<import('./bindings').RawBody>} batch
   * @param {import('./bindings').Environment} env
   */
  async queue (batch, env) {
    const client = new Client(new URL(env.GENDEX_API_URL), env.GENDEX_SERVICE ?? globalThis)
    const messages = batch.messages.map(decodeMessage)
    await processBatch(client, messages)
  }
}

/**
 * @param {Client} gendex
 * @param {import('@cloudflare/workers-types').Message<import('./bindings').Body>[]} messages
 */
async function processBatch (gendex, messages) {
  const queue = new Queue({ concurrency: 6 })
  /** @type {BatchItem[]} */
  let batch = []

  /** @param {BatchItem[]} batch */
  const addBatchToQueue = batch => queue.add(async () => {
    await gendex.putIndexes(batch.map(item => item.indexData))
    batch.forEach(item => item.message.ack())
  })

  await all(messages.map(message => async () => {
    const indexes = await gendex.generateIndexes(message.body.shards)
    await indexes.pipeTo(new WritableStream({
      write (indexData) {
        batch.push({ indexData, message })
        if (batch.length >= BATCH_SIZE) {
          addBatchToQueue(batch)
          batch = []
        }
      }
    }))
  }, { concurrency: 3 })) // we only get 6 concurrent sub-requests

  if (batch.length) {
    addBatchToQueue(batch)
  }

  await queue.onIdle()
}

/**
 * @param {import('@cloudflare/workers-types').Message<import('./bindings').RawBody>} message
 * @returns {import('@cloudflare/workers-types').Message<import('./bindings').Body>}
 */
function decodeMessage (message) {
  const body = decodeMessageBody(message.body)
  return {
    get id () { return message.id },
    get timestamp () { return message.timestamp },
    get body () { return body },
    retry () { message.retry() },
    ack () { message.ack() }
  }
}

/**
 * @param {import('./bindings').RawBody} body
 * @returns {import('./bindings').Body}
 */
function decodeMessageBody (body) {
  return {
    root: body.root ? Link.parse(body.root) : undefined,
    block: Link.parse(body.block),
    shards: body.shards.map(s => Link.parse(s))
  }
}
