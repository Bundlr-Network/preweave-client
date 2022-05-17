import Preweave from "../src/index.js";

(async function () {
    const preweave = new Preweave("http://198.244.230.218:10000");

    console.log(await preweave.uploadFile("__tests__/large-item"));
})();