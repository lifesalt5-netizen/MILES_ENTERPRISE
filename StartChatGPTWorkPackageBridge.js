"use strict";
const Bridge=require("./SERVICES/ChatGPTWorkPackageBridgeService");
const bridge=new Bridge(); bridge.start();
function stop(s){ console.log(`[CHATGPT BRIDGE] ${s} received.`); bridge.stop(); process.exit(0); }
process.on("SIGINT",()=>stop("SIGINT")); process.on("SIGTERM",()=>stop("SIGTERM"));
process.on("uncaughtException",e=>console.error("[CHATGPT BRIDGE] Uncaught exception:",e));
process.on("unhandledRejection",e=>console.error("[CHATGPT BRIDGE] Unhandled rejection:",e));
