/* eslint-env browser */
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import { MultiIndexReader, MultiIndexWriter } from 'cardex/multi-index'
import { MultihashIndexSortedWriter } from 'cardex/multihash-index-sorted'
import * as json from '@ipld/dag-json'
import { Map as LinkMap } from 'lnmap'

/**
 * @typedef {{ endpoint: URL } & import('./bindings').RequestDispatcher} Service
 */

/** @implements {Service} */
export class Client {
  /**
   * @param {URL} endpoint
   * @param {import('./bindings').RequestDispatcher} dispatcher
   */
  constructor (endpoint, dispatcher) {
    this.endpoint = endpoint
    this.fetch = dispatcher.fetch.bind(dispatcher)
  }

  /**
   * @param {import('./bindings').BlockIndex} blockIndex
   * @param {import('multiformats').UnknownLink} cid
   * @param {import('multiformats').UnknownLink[]} links
   */
  putBlockIndex (blockIndex, cid, links) {
    return putBlockIndex(this, blockIndex, cid, links)
  }

  /**
   * @param {import('cardex/api').CARLink[]} shards
   */
  getIndex (shards) {
    return getIndex(this, shards)
  }

  /**
   * @param {import('./bindings').BlockIndex} blockIndex
   * @param {import('multiformats').UnknownLink} cid
   */
  getBlockLinks (blockIndex, cid) {
    return getBlockLinks(this, blockIndex, cid)
  }
}

/**
 * Write an index for the provided cid.
 * @param {Service} service
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink} cid
 * @param {import('multiformats').UnknownLink[]} links
 */
export async function putBlockIndex (service, blockIndex, cid, links) {
  const res = await service.fetch(new URL(`/block/${cid}`, service.endpoint).toString(), {
    method: 'PUT',
    // @ts-expect-error
    body: writeMultiIndex(blockIndex, [cid, ...links])
  })
  if (!res.ok) throw new Error(`unexpected block index response status: ${res.status}`)
}

/**
 * Get a block index for the given shards.
 * @param {Service} service
 * @param {import('cardex/api').CARLink[]} shards
 */
export async function getIndex (service, shards) {
  const res = await service.fetch(new URL('/index', service.endpoint).toString(), {
    method: 'POST',
    body: json.encode(shards)
  })
  if (!res.body) throw new Error('missing index body stream')
  return readMultiIndex(res.body)
}

/**
 * Get links for a block.
 * @param {Service} service
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink} cid
 * @returns {Promise<{ block: import('multiformats').UnknownLink, links: import('multiformats').UnknownLink[], meta: any }>}
 */
export async function getBlockLinks (service, blockIndex, cid) {
  const res = await service.fetch(new URL(`/links/${cid}`, service.endpoint).toString(), {
    method: 'POST',
    // @ts-expect-error
    body: writeMultiIndex(blockIndex, [cid])
  })
  return json.decode(new Uint8Array(await res.arrayBuffer()))
}

/**
 * @param {import('./bindings').BlockIndex} blockIndex
 * @param {import('multiformats').UnknownLink[]} blocks
 * @returns {import('cardex/reader/api').Readable<Uint8Array>}
 */
export function writeMultiIndex (blockIndex, blocks) {
  /** @type {import('./bindings').ShardIndex} */
  const shardIndex = new LinkMap()
  for (const blockCID of blocks) {
    const offsets = blockIndex.get(blockCID)
    if (!offsets) throw new Error(`block not indexed: ${blockCID}`)
    const [shard, offset] = getAnyMapEntry(offsets)
    let blocks = shardIndex.get(shard)
    if (!blocks) {
      blocks = new LinkMap()
      shardIndex.set(shard, blocks)
    }
    blocks.set(blockCID, offset)
  }

  const { readable, writable } = new TransformStream()
  const writer = MultiIndexWriter.createWriter({ writer: writable.getWriter() })

  for (const [shard, blocks] of shardIndex.entries()) {
    writer.add(shard, async ({ writer }) => {
      const index = MultihashIndexSortedWriter.createWriter({ writer })
      for (const [cid, offset] of blocks.entries()) {
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
 */
export async function readMultiIndex (readable) {
  /** @type {import('./bindings').BlockIndex} */
  const blockIndex = new LinkMap()
  const reader = MultiIndexReader.createReader({ reader: readable.getReader() })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!('multihash' in value)) throw new Error('not MultihashIndexSorted')
    const item = /** @type {import('cardex/multi-index/api').MultiIndexItem & import('cardex/mh-index-sorted/api').MultihashIndexItem} */ (value)
    const blockCID = Link.create(raw.code, item.multihash)
    let shards = blockIndex.get(blockCID)
    if (!shards) {
      shards = new LinkMap()
      blockIndex.set(blockCID, shards)
    }
    shards.set(item.origin, item.offset)
  }
  return blockIndex
}

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
