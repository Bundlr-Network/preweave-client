import Preweave from "../src";

(async function () {
    const preweave = new Preweave("http://localhost:8080", "d820b3ad-55e8-4507-8302-c8b739319bdf");

    console.log(await preweave.upload("hello", { "content-type": "text/plain" }));
})();