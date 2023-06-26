import fs from 'node:fs'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { readBlockHead, bytesReader } from '@ipld/car/decoder'
import * as pb from '@ipld/dag-pb'
import { decodeBlock } from './block.js'

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

  return decodeBlock({ cid, bytes })
}
