import fs from 'node:fs'
import * as Block from 'multiformats/block'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { readBlockHead, bytesReader } from '@ipld/car/decoder'
import * as pb from '@ipld/dag-pb'

export const Decoders = {
  [raw.code]: raw,
  [pb.code]: pb
}

export const Hashers = {
  [sha256.code]: sha256
}

// 2MB (max safe libp2p block size) + typical block header length + some leeway
const MAX_ENCODED_BLOCK_LENGTH = (1024 * 1024 * 2) + 39 + 61

/**
 * @param {string} path
 * @param {number} offset
 */
export async function getBlock (path, offset) {
  const handle = await fs.promises.open(path)
  const res = await handle.read({ buffer: new Uint8Array(MAX_ENCODED_BLOCK_LENGTH), position: offset, length: MAX_ENCODED_BLOCK_LENGTH })
  const reader = bytesReader(res.buffer)

  const { cid, blockLength } = await readBlockHead(reader)
  const bytes = await reader.exactly(blockLength)
  await handle.close()

  const decoder = Decoders[cid.code]
  if (!decoder) throw Object.assign(new Error(`missing decoder: ${cid.code}`), { code: 'ERR_MISSING_DECODER' })
  const hasher = Hashers[cid.multihash.code]
  if (!hasher) throw Object.assign(new Error(`missing hasher: ${cid.multihash.code}`), { code: 'ERR_MISSING_HASHER' })

  return await Block.create({ cid, bytes: bytes.slice(), codec: decoder, hasher })
}
