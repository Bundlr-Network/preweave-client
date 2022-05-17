# Preweave Client

## Usage

### Upload data

Uploads data to a Preweave node. If the data is large enough, chunking will
be used internally.

```ts
import Preweave from "preweave-client";

const preweave = new Preweave("<preweave-node-url>", "<optional-api-arg>");

// Upload some `string` or `Buffer`
await preweave.upload("Hello World");

// Upload some file
await preweave.uploadFile("<filename>");
```

### Make permanent

```ts
await prweave.makeTxsPermanent([...list of tx IDs]);
```

### Hide transaction data

```ts
await prweave.hideTxs([...list of tx IDs]);
```

### Remove transactions

Be careful when using this as this will purge transaction data permanently

```ts
await prweave.removeTxs([...list of tx IDs]);
```