/* eslint-env browser */
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import http from 'node:http'
import { Set as LinkSet } from 'lnset'
import defer from 'p-defer'
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import * as json from '@ipld/dag-json'
import { MultihashIndexSortedReader, MultihashIndexSortedWriter } from 'cardex/multihash-index-sorted'
import { MultiIndexWriter } from 'cardex/multi-index'
import { readMultiIndex } from '../../src/client.js'
import { getBlock } from './fs-block.js'

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
    if (req.method === 'PUT' && req.url?.startsWith('/block')) {
      const cid = Link.parse(req.url.split('/')[2])
      todoCIDs.delete(cid)
      console.log(`    ${todoCIDs.size} CIDs TODO`)
      if (todoCIDs.size === 0) resolve()
      res.end()
    } else if (req.method === 'HEAD' && req.url?.startsWith('/block')) {
      const cid = Link.parse(req.url.split('/')[2])
      res.statusCode = todoCIDs.has(cid) ? 404 : 200
      res.end()
    } else if (req.method === 'POST' && req.url === '/index') {
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      /** @type {import('cardex/api').CARLink[]} */
      const shards = json.decode(Buffer.concat(chunks))

      const { writable, readable } = new TransformStream()
      const writer = MultiIndexWriter.createWriter({ writer: writable.getWriter() })
      for (const shard of shards) {
        writer.add(shard, async ({ writer }) => {
          const indexWriter = MultihashIndexSortedWriter.createWriter({ writer })
          const readable = Readable.toWeb(fs.createReadStream(`test/fixtures/${root}/${shard}.car.idx`))
          const indexReader = MultihashIndexSortedReader.createReader({ reader: readable.getReader() })
          while (true) {
            const { done, value } = await indexReader.read()
            if (done) break
            indexWriter.add(Link.create(raw.code, value.multihash), value.offset)
          }
          await indexWriter.close()
        })
      }
      writer.close()
      await readable.pipeTo(Writable.toWeb(res))
    } else if (req.method === 'POST' && req.url?.startsWith('/links')) {
      const blockCID = Link.parse(req.url.split('/')[2])
      const blockIndex = await readMultiIndex(Readable.toWeb(req))
      const blockShards = blockIndex.get(blockCID)
      if (!blockShards) {
        res.statusCode = 400
        return res.end()
      }

      const [shard, offset] = getAnyMapEntry(blockShards)
      const block = await getBlock(`test/fixtures/${root}/${shard}.car`, offset)
      const blockLinks = [...block.links()].map(([, cid]) => cid)

      console.log(`     ${blockCID} has ${blockLinks.length} links:`)
      blockLinks.forEach((cid, i) => console.log(`       ${i + 1}. ${cid}`))

      res.write(json.encode({ cid: blockCID, links: blockLinks }))
      res.end()
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
    close: () => server.close(),
    indexComplete: promise
  }
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
