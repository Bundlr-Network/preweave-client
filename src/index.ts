import path, { resolve } from "path";
import mime from "mime-types";
import * as fs from "fs";
import { chunkedDataUploader } from "./chunked";
import axios, { Axios } from "axios";
// import {BinaryLike} from "crypto";
import { Readable } from "stream";
import { checkAndThrow, checkPath } from "./utils";
import PromisePool from "@supercharge/promise-pool/dist";
import { Upload } from "@aws-sdk/lib-storage";
import { CompleteMultipartUploadCommandOutput, S3Client } from "@aws-sdk/client-s3";


type Status = "SUCCESS" | "FAIL";

interface Statuses {
    [key: string]: Status
}

interface UploadOpts {
    contentType?: string;
    soakPeriod?: number;
}

interface UploadResponse {
    txId: string;
}

interface AtomicItem {
    name: string
    data: Readable | Buffer | string
}


interface PoolResult {
    results: any[], errors: any[]
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
     * @param data
     * @param opts
     */
    async upload(data: string | Uint8Array, opts?: UploadOpts): Promise<UploadResponse> {
        const type = opts?.["content-type"] ?? "application/octet-stream";
        const size = data.length;
        let res;
        try {
            if (size < (10 * Preweave.MiB)) {
                res = await this.axios.post("/data", data, { headers: { "Content-Type": type, "X-Soak-Period": opts?.soakPeriod } });
            } else {
                res = await chunkedDataUploader(Readable.from(Buffer.from(data)), size, this.url, { contentType: type ?? opts?.contentType, soakPeriod: opts?.soakPeriod });
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
     * @param path
     * @param opts
     */
    async uploadFile(path: string, opts?: UploadOpts): Promise<UploadResponse> {
        path = resolve(path);
        const type = mime.lookup(path) || "application/octet-stream";
        const size = (await fs.promises.stat(path)).size;
        let res;
        try {
            if (size < (10 * Preweave.MiB)) {
                res = await this.axios.post("/data", fs.createReadStream(path), { headers: { "Content-Type": opts?.contentType ?? type } });
            } else {
                const rstrm = fs.createReadStream(path);
                res = await chunkedDataUploader(rstrm, size, this.url, { contentType: type ?? opts?.contentType, soakPeriod: opts?.soakPeriod });
            }
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }

        return {
            txId: res.data.txId
        };
    }

    /**
     * Makes transactions permanent for the given list of transactions
     *
     * @param txIds
     */
    async makeTxsPermanent(txIds: string[]): Promise<Statuses> {
        return (await this.axios.post("/txs/confirm", txIds, { headers: { "Content-Type": "application/json" } })).data;
    }

    /**
     * Hides transaction data for the given list of transactions
     *
     * @param txIds
     */
    async hideTxs(txIds: string[]): Promise<Statuses> {
        try {
            return (await this.axios.post("/txs/hide", txIds, { headers: { "Content-Type": "application/json" } })).data;
        } catch (e) {
            throw new Error(`Error from PreWeave node: ${e.response.data}`);
        }
    }

    /**
     * Hides transaction data for the given list of transactions
     *
     * @param txIds
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
     * Uploads the list of provided parts as an atomic group - all items must be present
     * before other processing (exporting, permanence) can occur.
     * @param paths - a list of FS paths to upload
     * @returns - the result(s) of the upload
     */
    async atomicUploadFiles(paths: string[]): Promise<PoolResult> {
        const key = await this.initialiseAtomicUpload(paths)
        const items = await Promise.all(paths.map(async (p) => {
            if (!await checkPath(p)) throw new Error(`Invalid path provided: ${p}`)
            return { name: path.basename(p), data: fs.createReadStream(p) }
        }))
        const poolRes = await this.atomicUpload(items, key)
        await this.finishAtomicUpload(key)
        return poolRes
    }

    /**
     * Uploads a set of tuple items as part of an atomic group
     * @param items - list of type AtomicItems to upload
     * @param key - the atomic group ID/key to upload these items to
     * @returns  - the results of the upload
     */
    async atomicUpload(items: AtomicItem[], key: string): Promise<PoolResult> {
        return new PromisePool()
            .withConcurrency(10)
            .for(items)
            .process(async (item: AtomicItem) => {
                return await this.uploadAtomicItem(item.name, item.data, key)
            })
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
     * @param name - the name of the item (should be an entry in the initialise names list)
     * @param data - data to upload
     * @param key - the key for the atomic group to associate this item with
     * @returns 
     */
    async uploadAtomicItem(name: string, data: AtomicItem["data"], key: string): Promise<CompleteMultipartUploadCommandOutput> {
        const upload = new Upload({
            client: this.S3,
            params: {
                Bucket: "preweave-txs", Key: name, Body: data, Metadata: {
                    "atomic-name": name,
                    "atomic-upload-id": key
                }
            }
        })
        return await upload.done()
    }

    /**
     * Attempts to finalise an atomic upload - will throw if any items are missing.
     * @param key - the key for the atomic group to finalise
     * @returns - nothing
     */
    async finishAtomicUpload(key: string): Promise<void> {
        return checkAndThrow(await this.axios.post("/atomic/finish", { key }))
    }
}


