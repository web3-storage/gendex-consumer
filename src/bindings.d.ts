import type { MultihashDigest } from 'multiformats/hashes/interface'
import type { ToString } from 'multiformats/link'
import type { CARLink } from 'cardex/api'

export type MultihashString = ToString<MultihashDigest, 'z'>
export type ShardCIDString = ToString<CARLink, 'b'>
export type Offset = number

export interface BlockIndex extends Map<MultihashString, Map<ShardCIDString, Offset>> {}
export interface ShardIndex extends Map<ShardCIDString, Map<MultihashString, Offset>> {}
