import * as Block from 'multiformats/block'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'

export const Decoders = {
  [raw.code]: raw,
  [pb.code]: pb
}

export const Hashers = {
  [sha256.code]: sha256
}

/**
 * @param {import('carstream/api').Block} block
 */
export async function decodeBlock ({ cid, bytes }) {
  const decoder = Decoders[cid.code]
  if (!decoder) throw Object.assign(new Error(`missing decoder: ${cid.code}`), { code: 'ERR_MISSING_DECODER' })
  const hasher = Hashers[cid.multihash.code]
  if (!hasher) throw Object.assign(new Error(`missing hasher: ${cid.multihash.code}`), { code: 'ERR_MISSING_HASHER' })
  return await Block.create({ cid, bytes, codec: decoder, hasher })
}
