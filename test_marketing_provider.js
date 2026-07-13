const MarketingProvider = require("./PROVIDERS/providers/MarketingProvider");

(async () => {

    const provider = new MarketingProvider();

    await provider.initialize();

    console.log(provider.getProviderState());

})();