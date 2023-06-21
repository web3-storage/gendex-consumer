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
where `root` is the root CID of a DAG to generate indexes for.

### Manually add a message to the queue

```sh
curl -X POST http://gendex-consumer.worker/send
```

The request body should be a JSON encoded message with the above format.
