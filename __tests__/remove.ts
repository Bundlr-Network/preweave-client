import Preweave from "../src";

(async function () {
    const preweave = new Preweave("http://localhost:8080", "43d02a29-4cc3-4d26-87aa-6846c6bc80d2");

    const txIds = [];
    for (let i = 0; i < 10; i++) txIds.push(await preweave.upload("hello").then(r => r.txId))

    console.log(await preweave.removeTxs(txIds));
})();