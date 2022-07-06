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
const statuses = await preweave.makeTxsPermanent([...list of tx IDs]);
```

### Hide transaction data

```ts
const statuses = await preweave.hideTxs([...list of tx IDs]);

// or to reveal them again
const statuses = await preweave.unhideTxs([...list of tx IDs]);
```

### Remove transactions

Be careful when using this as this will purge transaction data permanently

```ts
const statuses = await preweave.removeTxs([...list of tx IDs]);
```



### Atomic uploads
Atomic uploads allow for groups of uploads that are only added to PreWeave once all items in the group have uploaded successfully. 
Atomic uploads use a "key", which ties each upload with it to a specific group, as well as a "name" - a unique identifier for the item in the group (can be arbitrary)

#### Create a new Atomic group
Creates an atomic group, specifying the list of names for the group
```ts
const key = await preweave.initialiseAtomicUpload([...List of file names])
```

#### Upload an Atomic item
Uploads an atomic item (data + a unique name)
```ts
const res = await preweave.uploadAtomicItem({name: "test", data: "Hello, PreWeave!"}, key)
```

#### Upload a list of Atomic Items
Uploads a list of Atomic Items with concurrency, optionally generating a path manifest for the list.
```ts
const items = [...list of Atomic Items]
const poolRes = await atomicUpload(items, key, true)
```

#### Upload a directory as an Atomic group
Uploads a directory with concurrency, implicitly creating and finalising an atomic group for the folder, and optionally generating a path manifest for the folder.
```ts
const res = uploadAtomicDir("./files", true)
```

#### Finalise an atomic group
This function will attempt to finalise an Atomic group,and will throw if the atomic group is missing any items.
```ts
await preweave.finishAtomicUpload(key)
```