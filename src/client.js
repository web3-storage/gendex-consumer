/* eslint-env browser */
import * as Link from 'multiformats/link'
import { base58btc } from 'multiformats/bases/base58'
import * as raw from 'multiformats/codecs/raw'
import * as Digest from 'multiformats/hashes/digest'
import { MultiIndexReader, MultiIndexWriter } from 'cardex/multi-index'
import { MultihashIndexSortedWriter } from 'cardex/multihash-index-sorted'
import * as json from '@ipld/dag-json'
import * as ndjson from 'ndjson-web'

/**
 * Determine if a block index exists.
 * @param {URL} endpoint
 * @param {import('multiformats').UnknownLink} cid
 */
export async function hasBlockIndex (endpoint, cid) {
  const url = new URL(`/block/${cid}`, endpoint).toString()
  const res = await fetch(url, { method: 'HEAD' })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`unexpected block index response status: ${res.status}`)
}

/**
 * Write an index for the provided shard in SATNAV and add DUDEWHERE link.
 * @param {URL} endpoint
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink} cid
 * @param {import('multiformats').UnknownLink[]} links
 */
export async function putBlockIndex (endpoint, blockIndex, cid, links) {
  const res = await fetch(new URL(`/block/${cid}`, endpoint).toString(), {
    method: 'PUT',
    // @ts-expect-error
    body: writeMultiIndex(blockIndex, [cid, ...links]),
    duplex: 'half'
  })
  if (!res.body) throw new Error('missing block body stream')

  /** @type {Array<{ cid: import('multiformats').UnknownLink, links: import('multiformats').UnknownLink[], meta: any }>} */
  const results = []
  res.body.pipeThrough(new ndjson.Parse()).pipeTo(new WritableStream({
    write (item) { results.push(json.parse(JSON.stringify(item))) }
  }))
  if (!cid.equals(results.at(-1)?.cid)) {
    throw new Error()
  }
  return results.slice(0, -1)
}

/**
 * Get a block index of the entire DAG.
 * @param {URL} endpoint
 * @param {import('multiformats').UnknownLink} root
 * @param {number} [max] Maximum allowed blocks to read (throws if exceeded).
 */
export async function getBlockIndex (endpoint, root, max) {
  const res = await fetch(new URL(`/index/${root}`, endpoint).toString())
  if (!res.body) throw new Error('missing index body stream')
  return readMultiIndex(res.body, max)
}

/**
 * Get links for a block.
 * @param {URL} endpoint
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink} cid
 * @returns {Promise<{ cid: import('multiformats').UnknownLink, links: import('multiformats').UnknownLink[], meta: any }>}
 */
export async function getBlockLinks (endpoint, blockIndex, cid) {
  const res = await fetch(new URL(`/links/${cid}`, endpoint).toString(), {
    method: 'POST',
    // @ts-expect-error
    body: writeMultiIndex(blockIndex, [cid]),
    duplex: 'half'
  })
  return json.decode(new Uint8Array(await res.arrayBuffer()))
}

/**
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink[]} blocks
 * @returns {import('cardex/reader/api').Readable<Uint8Array>}
 */
function writeMultiIndex (blockIndex, blocks) {
  /** @type {import('./bindings').ShardIndex} */
  const shardIndex = new Map()
  for (const blockCID of blocks) {
    const blockMh = mhToString(blockCID.multihash)
    const offsets = blockIndex.get(blockMh)
    if (!offsets) throw new Error(`block not indexed: ${blockCID}`)
    const [shard, offset] = getAnyMapEntry(offsets)
    let blocks = shardIndex.get(shard)
    if (!blocks) {
      blocks = new Map()
      shardIndex.set(shard, blocks)
    }
    blocks.set(blockMh, offset)
  }

  const { readable, writable } = new TransformStream()
  const writer = MultiIndexWriter.createWriter({ writer: writable.getWriter() })

  for (const [shard, blocks] of shardIndex.entries()) {
    writer.add(Link.parse(shard), async ({ writer }) => {
      const index = MultihashIndexSortedWriter.createWriter({ writer })
      for (const [blockMh, offset] of blocks.entries()) {
        const cid = Link.create(raw.code, Digest.decode(base58btc.decode(blockMh)))
        index.add(cid, offset)
      }
      await index.close()
    })
  }

  writer.close()
  return readable
}

/**
 * @param {import('cardex/reader/api').Readable} readable
 * @param {number} [max] Maximum allowed blocks to read (throws if exceeded).
 */
async function readMultiIndex (readable, max = Infinity) {
  /** @type {import('./bindings').BlockIndex} */
  const blockIndex = new Map()
  const reader = MultiIndexReader.createReader({ reader: readable.getReader() })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!('multihash' in value)) throw new Error('not MultihashIndexSorted')
    const item = /** @type {import('cardex/multi-index/api').MultiIndexItem & import('cardex/mh-index-sorted/api').MultihashIndexItem} */ (value)
    const blockMh = mhToString(item.multihash)
    let shards = blockIndex.get(blockMh)
    if (!shards) {
      shards = new Map()
      blockIndex.set(blockMh, shards)
      if (blockIndex.size > max) {
        reader.cancel()
        throw new RangeError(`maximum index size exceeded (${max} blocks)`)
      }
    }
    shards.set(`${item.origin}`, item.offset)
  }
  return blockIndex
}

/**
 * Multibase encode a multihash with base58btc.
 * @param {import('multiformats').MultihashDigest} mh
 * @returns {import('multiformats').ToString<import('multiformats').MultihashDigest, 'z'>}
 */
const mhToString = mh => base58btc.encode(mh.bytes)

/**
 * @template K
 * @template V
 * @param {Map<K, V>} map
 */
function getAnyMapEntry (map) {
  const { done, value } = map.entries().next()
  if (done) throw new Error('empty map')
  return value
}
