import * as Link from 'multiformats/link'
import Queue from 'p-queue'
import retry from 'p-retry'
import { getBlockIndex, getBlockLinks, hasBlockIndex, putBlockIndex } from './client.js'

/**
 * @typedef {{ root: string }} Body
 * @typedef {{ GENDEX_API_URL: string, GENDEX_QUEUE: import('@cloudflare/workers-types').Queue<Body> }} Environment
 */

const CONCURRENCY = 12 // double max concurrent sub-requests
/** Maximum links a single block is allowed to have. */
const MAX_BLOCK_LINKS = 3000

export default {
  /**
   * @param {Request} request
   * @param {Environment} env
   * @param {unknown} ctx
   */
  async fetch (request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }
    const reqURL = new URL(request.url)
    if (!reqURL.pathname.startsWith('/send/')) {
      return new Response('method not allowed', { status: 404 })
    }
    const pathParts = reqURL.pathname.split('/')
    const cid = Link.parse(pathParts[2])
    await env.GENDEX_QUEUE.send({ root: cid.toString() })
    return new Response('send success 👍')
  },
  /**
   * @param {import('@cloudflare/workers-types').MessageBatch<Body>} batch
   * @param {Environment} env
   */
  async queue (batch, env) {
    const endpoint = new URL(env.GENDEX_API_URL)
    for (const message of batch.messages) {
      const root = Link.parse(message.body.root)
      await putBlockIndexes(endpoint, root)
      message.ack()
    }
  }
}

/**
 * @param {URL} endpoint Gendex API endpoint
 * @param {import('multiformats/link').UnknownLink} root
 */
export async function putBlockIndexes (endpoint, root, max = Infinity) {
  if (await hasBlockIndex(endpoint, root)) { // TODO: option to regenerate?
    return console.log(`Index already exists: ${root}`)
  }
  console.log(`Building indexes for: ${root}`)
  const blockIndex = await getBlockIndex(endpoint, root, max)
  console.log(`Retrieved indexes for DAG of ${blockIndex.size} blocks`)

  const { links: rootLinks } = await getBlockLinks(endpoint, blockIndex, root)
  console.log(`Root block has ${rootLinks.length} links`)
  if (rootLinks.length > MAX_BLOCK_LINKS) {
    throw new RangeError(`maximum single block links size exceeded ${rootLinks.length} > ${MAX_BLOCK_LINKS}`)
  }

  const queue = new Queue({ concurrency: CONCURRENCY })

  /** @param {{ cid: import('multiformats').UnknownLink, links: import('multiformats').UnknownLink[] }} item */
  const createTask = item => async () => {
    console.log(`${queue.size} index${queue.size === 1 ? '' : 'es'} in queue to write`)
    console.log(`Writing block index for: ${item.cid}`)
    const links = await retry(() => putBlockIndex(endpoint, blockIndex, item.cid, item.links), {
      onFailedAttempt: err => console.warn(`failed put block index for: ${item.cid}`, err)
    })

    console.log(`${item.cid} has ${item.links.length} links`)
    if (item.links.length > MAX_BLOCK_LINKS) {
      throw new RangeError(`maximum single block links size exceeded ${item.links.length} > ${MAX_BLOCK_LINKS}`)
    }

    for (const linkItem of links) {
      queue.add(createTask(linkItem))
    }
  }
  await queue.add(createTask({ cid: root, links: rootLinks }))
  await queue.onIdle()
}
