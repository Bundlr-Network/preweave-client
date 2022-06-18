import { Readable } from "stream";
import retry from "async-retry";
import axios, { AxiosResponse } from "axios";
import SizeChunker from "./size-chunker";
import { checkAndThrow } from "./utils";

/**
 * Chunking data uploader
 * @param dataStream - Readable for data
 * @param size - the size of the data (bytes)
 * @param host
 * @param chunkSize - optional size to chunk the file - min 1_000_000, max 190_000_000 (in bytes)
 * @param batchSize - number of chunks to concurrently upload
 * @param contentType
 * @param soakPeriod
 */
export async function chunkedDataUploader(
    dataStream: Readable,
    size: number,
    host: string,
    {
        chunkSize = 10_000_000,
        batchSize = 10,
        contentType = "application/octet-stream",
        soakPeriod
    }: {
        chunkSize?: number,
        batchSize?: number,
        contentType?: string,
        soakPeriod: number
    }): Promise<AxiosResponse> {

    if (batchSize < 1) {
        throw new Error("batch size too small! must be >=1")
    }

    const promiseFactory = (d: Buffer, o: number): Promise<Record<string, any>> => {
        return new Promise((r) => {
            retry(
                async () => {
                    await axios.post(`${host}/chunk/${id}/${o}`, d, {
                        headers: { "Content-Type": "application/octet-stream" },
                        maxBodyLength: Infinity,
                        maxContentLength: Infinity,
                    }).then(re => r({ o, d: re }))
                },
                { retries: 3, minTimeout: 1000, maxTimeout: 10_000 }
            )
        })

    }

    const getres = await axios.get(`${host}/chunk/${size}`);

    const id = getres.data.id

    const remainder = size % chunkSize;
    const chunks = (size - remainder) / chunkSize;

    const missing = [];
    for (let i = 0; i < chunks + 1; i++) {
        const s = i * chunkSize
        missing.push(s);
    }

    const ckr = new SizeChunker({
        chunkSize: chunkSize,
        flushTail: true
    })

    dataStream.pipe(ckr);

    let offset = 0;
    let processing = []

    for await (const chunk of ckr) {
        const data = chunk.data
        processing.push(promiseFactory(data, offset))
        if (processing.length === batchSize) {
            await Promise.all(processing);
            processing = [];
        }
        offset += data.length
    }

    await Promise.all(processing);
    const headers = {
        "Content-Type": contentType ?? "application/octet-stream",
    }
    if (soakPeriod) {
        headers["X-Soak-Period"] = soakPeriod
    }
    const finishUpload = await axios.post(`${host}/chunk/${id}/-1`, "", {
        headers,
        timeout: /** this.api.config.timeout ??**/ 100_000 * 10 // server side reconstruction can take a while
    })

    // this will throw if the dataItem reconstruction fails
    checkAndThrow(finishUpload, "Finalising upload")
    return finishUpload
}