import Preweave from "../src/index";

(async function () {
    const preweave = new Preweave("http://meta.preweave.bundlr.network");

    console.log(await preweave.uploadFile("__tests__/large-item"));
})();