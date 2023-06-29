import type { UnknownLink } from 'multiformats/link'
import type { CARLink } from 'cardex/api'
import type { Queue } from '@cloudflare/workers-types'

export interface RequestDispatcher {
  fetch: typeof fetch
}

export interface Environment {
  DEBUG?: string
  GENDEX_API_URL: string
  GENDEX_SERVICE: ServiceWorkerGlobalScope
  GENDEX_QUEUE: Queue<RawBody>
}

export interface RawBody {
  /**
   * Base encoded string CIDs of CAR shards the block (and it's descendents)
   * can be found.
   */
  shards: string[]
}

export interface Body {
  /**
   * CIDs of CAR shards the block (and it's descendents) can be found.
   */
  shards: CARLink[]
}

export interface IndexData {
  shard: CARLink
  block: UnknownLink
  offset: number
  length: number
}

export interface BlockIndexData extends IndexData {
  links: IndexData[]
}

export interface DAGJSONIndexData {
  shard: { '/': string }
  block: { '/': string }
  offset: number
  length: number
}

export interface DAGJSONBlockIndexData extends DAGJSONIndexData {
  links: DAGJSONIndexData[]
}
