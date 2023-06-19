# gendex-consumer

Cloudlfare queue consumer that submits blocks to gendex in order to build block indexes for uploaded DAGs.

## Usage

Send a message to the queue with the format: `{ root: string }` where `root` is the root CID of a DAG to generate indexes for.

### Manually add a message to the queue

```sh
curl -X POST http://gendex-consumer.worker/send/bafy...
```
