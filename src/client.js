/* eslint-env browser */
import * as json from '@ipld/dag-json'
import { Parse } from 'ndjson-web'

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
   * @param {import('./bindings').BlockIndexData[]} indexDatas
   */
  putIndexes (indexDatas) {
    return putIndexes(this, indexDatas)
  }

  /**
   * @param {import('cardex/api').CARLink[]} shards
   */
  generateIndexes (shards) {
    return generateIndexes(this, shards)
  }
}

/**
 * Write block indexes.
 * @param {Service} service
 * @param {import('./bindings').BlockIndexData[]} indexDatas
 */
export async function putIndexes (service, indexDatas) {
  const res = await service.fetch(new URL('/indexes', service.endpoint).toString(), {
    method: 'POST',
    body: json.encode(indexDatas)
  })
  if (!res.ok) throw new Error(`unexpected block index response status: ${res.status}`)
}

/**
 * Index the blocks in the passed shards.
 * @param {Service} service
 * @param {import('cardex/api').CARLink[]} shards
 */
export async function generateIndexes (service, shards) {
  const res = await service.fetch(new URL('/indexes/generate', service.endpoint).toString(), {
    method: 'POST',
    body: json.encode(shards)
  })
  if (!res.body) throw new Error('missing body')
  const ndjsonParser = /** @type {Parse<import('./bindings').BlockIndexData>} */(new Parse(json.parse))
  return res.body.pipeThrough(ndjsonParser)
}
