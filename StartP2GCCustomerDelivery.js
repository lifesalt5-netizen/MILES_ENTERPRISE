"use strict";

const http = require("http");
const { URL } = require("url");
const service = require("./SERVICES/customer/P2GCCustomerDeliveryService");
const P2GCFederalGrowthReviewHttpController = require("./SERVICES/revenue/P2GCFederalGrowthReviewHttpController");

const PORT = Number(process.env.P2GC_CUSTOMER_PORT || 8792);
const reviewController = new P2GCFederalGrowthReviewHttpController({ rootDir: __dirname });

function send(res, code, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Content-Length":Buffer.byteLength(text)});
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve,reject)=>{let data="";req.on("data",c=>{data+=c;if(data.length>1024*1024) req.destroy();});req.on("end",()=>{try{resolve(data?JSON.parse(data):{});}catch(e){reject(e);}});req.on("error",reject);});
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if(await reviewController.handle(req,res,url)) return;
    if(req.method==="GET" && url.pathname==="/api/health") return send(res,200,service.healthCheck());
    if(req.method==="GET" && url.pathname==="/api/revenue") return send(res,200,service.revenueCommandCenter());
    if(req.method==="GET" && url.pathname==="/api/meetings") return send(res,200,service.meetingPipeline());
    if(req.method==="GET" && url.pathname==="/api/client-success") return send(res,200,service.clientSuccessDashboard());
    if(req.method==="GET" && url.pathname==="/api/portal") return send(res,200,service.portal(url.searchParams.get("clientId")));
    if(req.method==="GET" && url.pathname==="/api/brief") return send(res,200,service.executiveBrief(url.searchParams.get("clientId")));
    if(req.method==="GET" && url.pathname==="/api/list") return send(res,200,service.list(url.searchParams.get("kind")||"prospects"));
    if(req.method==="POST") {
      const body=await readBody(req);
      if(url.pathname==="/api/prospect") return send(res,200,service.upsertProspect(body));
      if(url.pathname==="/api/client") return send(res,200,service.upsertClient(body));
      if(url.pathname==="/api/onboarding/start") return send(res,200,service.startOnboarding(body));
      if(url.pathname==="/api/onboarding/complete") return send(res,200,service.completeOnboarding(body));
      if(url.pathname==="/api/subscription") return send(res,200,service.upsertSubscription(body));
      if(url.pathname==="/api/invoice") return send(res,200,service.createInvoice(body));
      if(url.pathname==="/api/referral") return send(res,200,service.addReferral(body));
    }
    send(res,404,{ok:false,status:"NOT_FOUND"});
  } catch(error) { send(res,500,{ok:false,status:"ERROR",error:error.message}); }
});

server.listen(PORT,"127.0.0.1",()=>console.log(`[P2GC CUSTOMER DELIVERY] http://127.0.0.1:${PORT}`));

function shutdown(){server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
