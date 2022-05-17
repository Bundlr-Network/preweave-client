# Preweave Client

## Usage

### Upload data

Uploads data to a Preweave node. If the data is large enough, chunking will
be used internally.

```ts
import Preweave from "preweave-client";

const preweave = new Preweave("<preweave-node-url>", "<optional-api-arg>");

// Upload some `string` or `Buffer`
const { txId } = await preweave.upload("Hello World");

// Upload some file
const { txId } = await preweave.uploadFile("<filename>");

// NOTE: `upload` and `uploadFile` will throw if an error is thrown by the PreWeave node
```

### Make permanent

```ts
const statuses = await prweave.makeTxsPermanent([...list of tx IDs]);
```

### Hide transaction data

```ts
const statuses = await prweave.hideTxs([...list of tx IDs]);

// or to reveal them again
const statuses = await prweave.unhideTxs([...list of tx IDs]);
```

### Remove transactions

Be careful when using this as this will purge transaction data permanently

```ts
const statuses = await prweave.removeTxs([...list of tx IDs]);
```