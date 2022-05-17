import { resolve } from "path";
import mime from "mime-types";
import * as fs from "fs";
import {chunkedDataUploader} from "./chunked";
import axios from "axios";
// import {BinaryLike} from "crypto";
import {Readable} from "stream";

interface Options {
    "content-type"?: string
}

export default class Preweave {
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

    async upload(data: string | Uint8Array, opts?: Options): Promise<any> {
        const type = opts?.["content-type"] ?? "application/octet-stream";
        // @ts-ignore
        const size = data.length;
        let res;
        if (size < (10 * Preweave.MiB)) {
            res = await this.axios.post("/data", data, { headers: { "Content-Type": type } });
        } else {
            res = await chunkedDataUploader(Readable.from(Buffer.from(data)), size, this.url, { contentType: type });
        }

        return {
            txId: res.data.txId
        };
    }

    async uploadFile(path: string): Promise<any> {
        path = resolve(path);
        const type = mime.lookup(path) || "application/octet-stream";
        const size = (await fs.promises.stat(path)).size;
        let res;
        if (size < (10 * Preweave.MiB)) {
            res = await this.axios.post("/data", fs.createReadStream(path), { headers: { "Content-Type": type } });
        } else {
            const rstrm = fs.createReadStream(path);
            res = await chunkedDataUploader(rstrm, size, this.url, { contentType: type });
        }

        return {
            txId: res.data.txId
        };
    }

    async makeTxsPermanent(txIds: string[]): Promise<any> {
        return (await this.axios.post("/txs/confirm", txIds, { headers: { "Content-Type": "application/json" }})).data;
    }

    async hideTxs(txIds: string[]): Promise<any> {
        return (await this.axios.post("/txs/hide", txIds, { headers: { "Content-Type": "application/json" }})).data;
    }

    async removeTxs(txIds: string[]): Promise<any> {
        return (await this.axios.post("/txs/remove", txIds, { headers: { "Content-Type": "application/json" }})).data;
    }
}


