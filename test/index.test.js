import { Log, LogLevel, Miniflare } from 'miniflare'
import * as Link from 'multiformats/link'
import { mockGendexAPI } from './helpers/gendex.js'

/** @type {Array<[import('multiformats').UnknownLink, import('cardex/api.js').CARLink[]]>} */
const fixtures = [
  [
    Link.parse('bafybeibh2vm6lfj2bevegl53r25md5yz3xjh3yizbftqpavrf2vf6wn4k4'),
    [
      Link.parse('bagbaierajof3gtknpbqfejemlwdergd2cozbainaalot2wgivjq5i34rzmia'),
      Link.parse('bagbaieraeprsmvpmuj54wjoy5i5ep3lwuxcorfwvsiixndc25jjqxug3qcya'),
      Link.parse('bagbaiera6tyhzhas5bwtgztxwpd2f6xeu5c6lgwzrx6mhvck3xb73nvdetgq')
    ]
  ]
]

/** @type {Record<string, import('entail').Test>} */
export const test = {}

for (const [root, shards] of fixtures) {
  test[`should index ${root}`] = async assert => {
    const gendexAPI = await mockGendexAPI(root, shards)
    const mf = new Miniflare({
      scriptPath: 'dist/worker.mjs',
      modules: true,
      bindings: {
        GENDEX_API_URL: `http://127.0.0.1:${gendexAPI.port}`
      },
      queueProducers: {
        GENDEX_QUEUE: 'gendex-test'
      },
      queueConsumers: {
        'gendex-test': {}
      },
      log: new Log(LogLevel.VERBOSE),
      compatibilityDate: '2023-05-18'
    })

    const res = await mf.dispatchFetch('http://localhost:8787/process', {
      method: 'POST',
      body: JSON.stringify({
        root: root.toString(),
        block: root.toString(),
        shards: shards.map(s => s.toString()),
        recursive: true,
        rawLeaves: true
      })
    })
    assert.ok(res.ok, await res.text())

    await gendexAPI.indexComplete
    gendexAPI.close()
    mf.dispose()
  }
}
