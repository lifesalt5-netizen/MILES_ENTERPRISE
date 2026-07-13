"use strict";
const BaseProviderController = require("./BaseProviderController");
class NamecheapProviderController extends BaseProviderController {
    constructor() {
        super({
            key: "namecheap",
            name: "Namecheap",
            executable: false,
            envKeys: ["NAMECHEAP_API_USER", "NAMECHEAP_API_KEY", "NAMECHEAP_USERNAME", "NAMECHEAP_CLIENT_IP"],
            supportedOperations: ["HEALTH_CHECK", "LIST_DOMAINS", "UPDATE_DNS_OR_VERIFY_AUTH", "VERIFY_SPF", "VERIFY_DKIM", "VERIFY_DMARC"]
        });
    }
}
module.exports = new NamecheapProviderController();
