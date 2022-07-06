import Preweave from "../src"

(async function () {
    const pw = new Preweave("http://172.17.0.4:8080")
    const key = await pw.initialiseAtomicUpload(["test"])
    const res = await pw.uploadAtomicItem("test", Buffer.from("test"), key)
    const finish = await pw.finishAtomicUpload(key)
    console.log({ res, finish })
})()