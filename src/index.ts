import { resolve } from "path";
import mime from "mime-types";
import * as fs from "fs";
import { chunkedDataUploader } from "./chunked";
import axios from "axios";
// import {BinaryLike} from "crypto";
import { Readable } from "stream";

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

export default class Preweave {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    static MiB = 1024 * 1024;
    axios;

    constructor(private url: string, apiKey?: string) {
        this.axios = axios.create({
            baseURL: url,
            headers: {
                "x-api-key": apiKey || ""
            }
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
}


