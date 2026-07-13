const { OutboundService } = require('../SERVICES/OutboundService');
const service = new OutboundService(process.cwd());
service.init();
console.log(service.reportMarkdown());
