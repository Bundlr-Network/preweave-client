import mime from "mime-types";
import * as fs from "fs";
import { chunkedDataUploader } from "./chunked";
import axios, { Axios } from "axios";
// import {BinaryLike} from "crypto";
import { Readable } from "stream";
import { checkAndThrow, walk } from "./utils";
import PromisePool from "@supercharge/promise-pool/dist";
import { Upload } from "@aws-sdk/lib-storage";
import { CompleteMultipartUploadCommandOutput, S3Client } from "@aws-sdk/client-s3";
import { relative, resolve } from "path"

type Status = "SUCCESS" | "FAIL";

interface Statuses {
    [key: string]: Status
}

interface UploadOpts {
    "content-type"?: string;
    "soak-period"?: number;
}

interface UploadResponse {
    txId: string;
}

interface AtomicItem {
    name: string
    data: Readable | Buffer | string,
    metadata?: {
        "content-type"?: string
    }
}


interface PoolResult {
    results: any[], errors: any[]
}
interface ManifestPoolResult extends PoolResult {
    manifest: string
}

export const baseManifest = {
    "manifest": "arweave/paths",
    "version": "0.1.0",
    "paths": {}
}

export default class Preweave {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    static MiB = 1024 * 1024;
    axios: Axios
    S3: S3Client

    constructor(private url: string, apiKey?: string) {
        this.axios = axios.create({
            baseURL: url,
            headers: {
                "x-api-key": apiKey || ""
            }
        })
        this.S3 = new S3Client({
            endpoint: `${url}/S3`,
            forcePathStyle: true,
            region: "us-east-1",
            // hardcoded for now.
            credentials: {
                accessKeyId: "Preweave",
                secretAccessKey: "Preweave"
            },
            maxAttempts: 10
        })
    }

    /**
     * Uploads some arbitrary data
     *
     * @param data - data to upload, strings will be converted assuming UTF8 encoding
     * @param opts - options for the upload, including content-type and soak period
     */
    async upload(data: string | Uint8Array, opts?: UploadOpts): Promise<UploadResponse> {
        const type = opts?.["content-type"] ?? "application/octet-stream";
        const size = data.length;
        let res;
        try {
            if (size < (10 * Preweave.MiB)) {
                res = await this.axios.post("/data", data, { headers: { "Content-Type": type, "X-Soak-Period": opts?.["soak-period"] ?? 0 } });
            } else {
                res = await chunkedDataUploader(Readable.from(Buffer.from(data)), size, this.url, { contentType: type, soakPeriod: opts?.["soak-period"] ?? 0 });
            }
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }


        return {
            txId: res.data.txId
        };
    }

    /**
     * Uploads a file
     *
     * @param path - path to the file to upload
     * @param opts - options for the upload, including content-type (overrides detected type) and soak period
     */
    async uploadFile(path: string, opts?: UploadOpts): Promise<UploadResponse> {
        path = resolve(path);
        const type = mime.lookup(path) || "application/octet-stream";
        const size = (await fs.promises.stat(path)).size;
        let res;
        try {
            if (size < (10 * Preweave.MiB)) {
                res = await this.axios.post("/data", fs.createReadStream(path), { headers: { "Content-Type": opts?.["content-type"] ?? type, "X-Soak-Period": opts?.["soak-period"] ?? 0 } });
            } else {
                const rstrm = fs.createReadStream(path);
                res = await chunkedDataUploader(rstrm, size, this.url, { contentType: type ?? opts?.["content-type"], soakPeriod: opts?.["soak-period"] });
            }
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }

        return {
            txId: res.data.txId
        };
    }

    /**
     * Makes a given list of transaction IDs permanent
     *
     * @param txIds - list of transaction IDs to make permanent
     */
    async makeTxsPermanent(txIds: string[]): Promise<Statuses> {
        return (await this.axios.post("/txs/confirm", txIds, { headers: { "Content-Type": "application/json" } })).data;
    }

    /**
     * Hides transaction data for the given list of transactions
     *
     * @param txIds - list of transaction IDs to hide
     */
    async hideTxs(txIds: string[]): Promise<Statuses> {
        try {
            return (await this.axios.post("/txs/hide", txIds, { headers: { "Content-Type": "application/json" } })).data;
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }
    }

    /**
     * Unhides transaction data for the given list of transactions
     *
     * @param txIds - list of transaction IDs to unhide
     */
    async unhideTxs(txIds: string[]): Promise<Statuses> {
        try {
            return (await this.axios.post("/txs/unhide", txIds, { headers: { "Content-Type": "application/json" } })).data;
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }
    }

    /**
     * Permanently removes the given transactions
     *
     * @param txIds
     */
    async removeTxs(txIds: string[]): Promise<Statuses> {
        try {
            return (await this.axios.post("/txs/remove", txIds, { headers: { "Content-Type": "application/json" } })).data;
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }
    }


    /**
     * Uploads a directory as an atomic group
     * @param path - directory to upload
     * @param genManifest - whether to generate + upload a manifest
     * @returns - Result of the processing pool, with the id of the generated manifest if applicable
     */
    async uploadAtomicDir(path: string, genManifest?: boolean): Promise<PoolResult | ManifestPoolResult> {
        const items = []
        for await (const f of walk(path)) {
            const relPath = relative(path, f)

            const contentType = mime.contentType(mime.lookup(f) || "application/octet-stream") as string

            items.push({
                name: relPath,
                data: fs.createReadStream(f),
                metadata: {
                    "content-type": contentType
                }
            })
        }
        const key = await this.initialiseAtomicUpload(items.map(i => i.name))

        const res = await this.atomicUpload(items, key, genManifest)
        await this.finishAtomicUpload(key)
        return res
    }


    /**
     * Uploads a set of atomic items as part of an atomic group
     * @param items - list of type AtomicItems to upload
     * @param key - the atomic group ID/key to upload these items to
     * @returns  - Result of the processing pool, with the id of the generated manifest if applicable
     */
    async atomicUpload(items: AtomicItem[], key: string, genManifest?: boolean): Promise<PoolResult | ManifestPoolResult> {
        const pool = await new PromisePool()
            .withConcurrency(10)
            .for(items)
            .process(async (item: AtomicItem) => {
                return { id: await this.uploadAtomicItem(item, key), name: item.name }
            })
        if (!genManifest) return pool;
        const manifest = baseManifest
        for (const result of pool.results) {
            manifest.paths[result.name] = { id: result.id }
        }
        const res = await this.upload(JSON.stringify(manifest), { "content-type": "application/x.arweave-manifest+json" })
        return { ...pool, manifest: res.txId }
    }


    /**
     * Initialises an atomic upload - creates an atomic group for the provided names
     * @param names - the list of unique names to require for the atomic group
     * @returns - the atomic upload ID/Key for the new group
     */
    async initialiseAtomicUpload(names: string[]): Promise<string> {
        const res = await this.axios.post("/atomic/create", names)
        checkAndThrow(res, "Initialising atomic upload")
        return res.data

    }

    /**
     * Uploads an atomic item to the specified atomic group
     * @param key - the key for the atomic group to associate this item with
     * @returns - the ID the item has been assigned
     */
    async uploadAtomicItem(item: AtomicItem, key: string): Promise<string> {
        const upload = new Upload({
            client: this.S3,
            params: {
                Bucket: "preweave-txs", Key: item.name, Body: item.data, Metadata: {
                    "atomic-name": item.name,
                    "atomic-upload-id": key,
                    ...item.metadata
                }
            }
        })
        const res = await upload.done() as CompleteMultipartUploadCommandOutput
        return res.ETag ?? res.$metadata.requestId
    }

    /**
     * Attempts to finalise an atomic upload - will throw if any items are missing.
     * @param key - the key for the atomic group to finalise
     * @returns - nothing, but will throw if the finalisation fails
     */
    async finishAtomicUpload(key: string): Promise<void> {
        return checkAndThrow(await this.axios.post("/atomic/finish", { key }))
    }
}


