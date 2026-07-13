const OrionProvider = require("./PROVIDERS/providers/OrionProvider");

(async () => {

    const provider = new OrionProvider();

    await provider.initialize();

    console.log(provider.getProviderState());

})();