# gendex-consumer

Cloudlfare queue consumer that submits blocks to gendex in order to build block indexes for uploaded DAGs.

## Usage

Send a message to the queue with the format: 

```ts
{
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
  /**
   * True to index the given block, it's links, it's links links etc.
   */
  recursive?: boolean
}
```

Passing shard CIDs allows gendex to not require a root CID and thus allows it to not require a DUDEWHERE index (to lookup shard CIDs). It also removes the hard dependency on SATNAV, in the event that there are no indexes in SATNAV for the passed shards, they can be materialized from the source data as needed.

In current NFT.Storage and web3.storage APIs we know the shards because linkdex returns them (and we'll only submit to gendex when linkdex says that a DAG is "Complete" in structure). In the new w3up APIs our `upload/add` invocation includes `root` and `shards` allowing us to submit to gendex when this call is made.

Setting `recursive: false` allows individual blocks requested by bitswap that are not yet indexed in blockly to be added from information available in the current Elastic IPFS DynamoDB.

### Manually add a message to the queue

```sh
curl -X POST http://gendex-consumer.worker/send
```

The request body should be a JSON encoded message with the above format.
