import { Readable } from "stream";
import retry from "async-retry";
// import SizeChunker from "../src/utils/chunker";
// import { PassThrough } from "stream"
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
    // eslint-disable-next-line prefer-const
    let id: string;

    // if (chunkSize < 1_000_000 || chunkSize > 190_000_000) {
    //     throw new Error("Invalid chunk size - must be between 1,000,000 and 190,000,000 bytes")
    // }

    if (batchSize < 1) {
        throw new Error("batch size too small! must be >=1")
    }

    const promiseFactory = (d: Buffer, o: number): Promise<Record<string, any>> => {
        return new Promise((r) => {
            retry(
                async () => {
                    axios.post(`${host}/chunk/${id}/${o}`, d, {
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

    id = getres.data.id

    const remainder = size % chunkSize;
    const chunks = (size - remainder) / chunkSize;

    const missing = [];
    for (let i = 0; i < chunks + 1; i++) {
        const s = i * chunkSize
        missing.push(s);
    }


    let offset = 0;
    const processing = []

    const ckr = new SizeChunker({
        chunkSize: chunkSize,
        flushTail: true
    })
    // const ckr = new PassThrough()

    dataStream.pipe(ckr);


    for await (const chunk of ckr) {
        const data = chunk.data
        if (chunk.id % batchSize == 0) {
            await Promise.allSettled(processing);
        }
        processing.push(promiseFactory(data, offset))
        offset += data.length
    }

    await Promise.allSettled(processing);
    let headers = {
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