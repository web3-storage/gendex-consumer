import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import { Map as LinkMap } from 'lnmap'
import { Set as LinkSet } from 'lnset'
import all from 'p-all'
import { Client } from './client.js'

/** Maximum links a single block is allowed to have. */
const MAX_BLOCK_LINKS = 3000
const CONCURRENCY = 6

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
        if (message.recursive) throw new Error('recursive not supported')
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
        const queue = { send: async () => {} }
        await processBatch(queue, client, messages)
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
    await processBatch(env.GENDEX_QUEUE, client, messages)
  }
}

/**
 * @param {Pick<import('@cloudflare/workers-types').Queue<import('./bindings').RawBody>, 'send'>} queue
 * @param {Client} gendex
 * @param {import('@cloudflare/workers-types').Message<import('./bindings').Body>[]} messages
 */
async function processBatch (queue, gendex, messages) {
  /** @type {Map<import('multiformats').UnknownLink, import('@cloudflare/workers-types').Message<import('./bindings').Body>[]>} */
  const groups = new LinkMap()
  for (const message of messages) {
    let group = groups.get(message.body.root ?? message.body.block)
    if (!group) {
      group = []
      groups.set(message.body.root ?? message.body.block, group)
    }
    group.push(message)
  }

  for (const [, messages] of groups) {
    /** @type {Set<import('cardex/api').CARLink>} */
    const shards = new LinkSet()
    messages.forEach(m => m.body.shards.forEach(s => shards.add(s)))
    const blockIndex = await gendex.getIndex([...shards.values()])

    await all(messages.map(message => async () => {
      try {
        /** @type {import('multiformats').UnknownLink[]} */
        let links = []
        if (message.body.block.code !== raw.code) {
          links = await gendex.getBlockLinks(blockIndex, message.body.block)
          if (links.length > MAX_BLOCK_LINKS) {
            throw Object.assign(new RangeError(`maximum single block links exceeded: ${message.body.block}`), { code: 'ERR_MAX_LINKS' })
          }
        }

        await gendex.putBlockIndex(blockIndex, message.body.block, links)
        if (message.body.recursive) {
          await Promise.all(links.map(link => (
            queue.send({
              root: message.body.root?.toString(),
              block: link.toString(),
              shards: message.body.shards.map(s => s.toString()),
              recursive: true
            })
          )))
        }

        message.ack()
      } catch (err) {
        if (err.code === 'ERR_MAX_LINKS') {
          message.ack() // do not retry when block exceeds max links
        } else {
          console.error(err)
          message.retry()
        }
      }
    }), { concurrency: CONCURRENCY })
  }
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
    shards: body.shards.map(s => Link.parse(s)),
    recursive: body.recursive
  }
}
