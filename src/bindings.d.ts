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
   * Base encoded string CID of block to index.
   */
  block: string
  /**
   * Base encoded string CIDs of CAR shards the block (and it's descendents)
   * can be found.
   */
  shards: string[]
  /**
   * Base encoded string CID of parent DAG (if known). Used to group messages
   * in a batch from the same DAG so index data has to be read only once for
   * the group.
   */
  root?: string
}

export interface Body {
  /**
   * CID of block to index
   */
  block: UnknownLink
  /**
   * CIDs of CAR shards the block (and it's descendents) can be found.
   */
  shards: CARLink[]
  /**
   * CID of parent DAG (if known). Used to group messages in a batch from the
   * same DAG so index data has to be read only once for the group.
   */
  root?: UnknownLink
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
