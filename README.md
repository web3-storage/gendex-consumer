# gendex-consumer

<p>
  <a href="https://github.com/web3-storage/gendex-consumer/actions/workflows/release.yml"><img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/web3-storage/gendex-consumer/test.yml?branch=main&style=for-the-badge" /></a>
  <a href="https://github.com/web3-storage/gendex-consumer/blob/main/LICENSE.md"><img alt="License: Apache-2.0 OR MIT" src="https://img.shields.io/badge/LICENSE-Apache--2.0%20OR%20MIT-yellow?style=for-the-badge" /></a>
</p>

Cloudlfare queue consumer that submits blocks to gendex in order to build block indexes for uploaded DAGs.

## Usage

Send a message to the queue with the format: 

```ts
interface Message {
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
```

Passing shard CIDs allows gendex to not require a root CID and thus allows it to not require a DUDEWHERE index (to lookup shard CIDs). It also removes the hard dependency on SATNAV, in the event that there are no indexes in SATNAV for the passed shards, they can be materialized from the source data as needed.

In current NFT.Storage and web3.storage APIs we know the shards because linkdex returns them (and we'll only submit to gendex when linkdex says that a DAG is "Complete" in structure). In the new w3up APIs our `upload/add` invocation includes `root` and `shards` allowing us to submit to gendex when this call is made.

Setting `recursive: false` allows individual blocks requested by bitswap that are not yet indexed in blockly to be added from information available in the current Elastic IPFS DynamoDB.

### Manually add a message to the queue

e.g.

```sh
curl --header "Content-Type: application/json" \
  --request POST \
  --data '{"block":"bafybeigwaxpc64gtjs25brjozyktwhdnr3hirrbnjyq746gd26mhe7jllm","shards":["bagbaierarysgidzym55qcdud66parpzxo6jb2wj3vpzax6lhtw7vaxmy224a"],"root":"bafybeigwaxpc64gtjs25brjozyktwhdnr3hirrbnjyq746gd26mhe7jllm","recursive":true}' \
  https://gendex-consumer-env.org.workers.dev/send
```

## Contributing

Feel free to join in. All welcome. Please [open an issue](https://github.com/web3-storage/gendex-consumer/issues)!

## License

Dual-licensed under [MIT + Apache 2.0](https://github.com/web3-storage/gendex-consumer/blob/main/LICENSE.md)
