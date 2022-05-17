import Preweave from "../src";

(async function () {
    const preweave = new Preweave("http://localhost:8080");

    const txIds = [];
    for (let i = 0; i < 10; i++) txIds.push(await preweave.upload("hello").then(r => r.txId))

    console.log(await preweave.makeTxsPermanent(txIds));
})();