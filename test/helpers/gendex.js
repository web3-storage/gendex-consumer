/* eslint-env browser */
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import http from 'node:http'
import { Set as LinkSet } from 'lnset'
import { Map as LinkMap } from 'lnmap'
import defer from 'p-defer'
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import * as json from '@ipld/dag-json'
import { MultihashIndexSortedReader } from 'cardex/multihash-index-sorted'
import { CARReaderStream } from 'carstream'
import { Stringify } from 'ndjson-web'
import { decodeBlock } from './block.js'

/**
 * @param {import('multiformats').UnknownLink} root
 * @param {import('cardex/api').CARLink[]} shards
 */
export async function mockGendexAPI (root, shards) {
  const todoCIDs = new LinkSet()
  for (const shard of shards) {
    const readable = Readable.toWeb(fs.createReadStream(`test/fixtures/${root}/${shard}.car.idx`))
    const indexReader = MultihashIndexSortedReader.createReader({ reader: readable.getReader() })
    while (true) {
      const { done, value } = await indexReader.read()
      if (done) break
      todoCIDs.add(Link.create(raw.code, value.multihash))
    }
  }
  console.log(`${todoCIDs.size} CIDs TODO`)

  const { promise, resolve } = defer()
  const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`)
    if (req.method === 'POST' && req.url === '/indexes') {
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      /** @type {import('../../src/bindings').BlockIndexData[]} */
      const indexDatas = json.decode(Buffer.concat(chunks))
      indexDatas.forEach(indexData => {
        todoCIDs.delete(indexData.block)
        console.log(`    ${todoCIDs.size} CIDs TODO`)
      })
      if (todoCIDs.size === 0) resolve()
      res.end()
    } else if (req.method === 'POST' && req.url === '/indexes/generate') {
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      /** @type {import('cardex/api').CARLink[]} */
      const shards = json.decode(Buffer.concat(chunks))

      const iterator = (async function * () {
        for (const shard of shards) {
          const blocks = /** @type {ReadableStream<import('carstream/api').Block & import('carstream/api').Position>} */ (
            // @ts-expect-error
            Readable.toWeb(fs.createReadStream(`test/fixtures/${root}/${shard}.car`)).pipeThrough(new CARReaderStream())
          )
          // @ts-expect-error
          for await (const block of blocks) {
            if (!block) continue
            yield { shard, ...block }
          }
        }
      })()
      /** @type {ReadableStream<{ shard: import('cardex/api').CARLink } & import('carstream/api').Block & import('carstream/api').Position>} */
      const readable = new ReadableStream({
        async pull (controller) {
          const { value, done } = await iterator.next()
          if (done) {
            controller.close()
          } else {
            controller.enqueue(value)
          }
        }
      })

      /** @type {Map<import('multiformats/link').UnknownLink, import('../../src/bindings').IndexData & { links: import('multiformats').UnknownLink[] }>} */
      const blockIndex = new LinkMap()
      /** @type {Map<import('multiformats/link').UnknownLink, import('multiformats/link').UnknownLink[]>} */
      const missingTargets = new LinkMap()

      /**
       * @param {import('multiformats').UnknownLink} cid
       * @returns {import('../../src/bindings').BlockIndexData}
       */
      const toBlocklyIndex = cid => {
        const index = blockIndex.get(cid)
        if (!index) throw new Error(`missing index: ${cid}`)
        return {
          block: index.block,
          shard: index.shard,
          offset: index.offset,
          length: index.length,
          links: index.links.map(l => {
            const linkIndex = blockIndex.get(l)
            if (!linkIndex) throw new Error(`missing link index: ${l}`)
            return { block: l, shard: linkIndex.shard, offset: linkIndex.offset, length: linkIndex.length }
          })
        }
      }

      await readable
        .pipeThrough(new TransformStream({
          async transform ({ shard, cid, bytes, offset, length }, controller) {
            if (blockIndex.has(cid)) return
            const block = await decodeBlock({ cid: Link.decode(cid.bytes.slice()), bytes: bytes.slice() })
            const links = [...block.links()].map(([, cid]) => Link.decode(cid.bytes.slice()))
            blockIndex.set(block.cid, { block: block.cid, shard, offset, length, links })

            if (links.every(l => blockIndex.has(l))) {
              controller.enqueue(toBlocklyIndex(block.cid))
            }

            for (const link of links) {
              if (blockIndex.has(link)) continue
              let targets = missingTargets.get(link)
              if (!targets) {
                targets = []
                missingTargets.set(link, targets)
              }
              targets.push(block.cid)
            }

            const targets = missingTargets.get(block.cid)
            if (targets) {
              for (const target of targets) {
                const index = blockIndex.get(target)
                if (!index) throw new Error('missing block target')
                if (index.links.every(l => blockIndex.has(l))) {
                  controller.enqueue(toBlocklyIndex(target))
                }
              }
              missingTargets.delete(block.cid)
            }
          }
        }))
        .pipeThrough(new Stringify(json.stringify))
        .pipeTo(Writable.toWeb(res))
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise(resolve => server.listen(resolve))

  // @ts-expect-error
  const { port } = server.address()
  return {
    port,
    close: () => new Promise(resolve => server.close(resolve)),
    indexComplete: promise
  }
}
