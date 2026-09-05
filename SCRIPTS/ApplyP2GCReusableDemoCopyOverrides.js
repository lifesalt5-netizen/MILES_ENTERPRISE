'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MASTER=path.join(ROOT,'DATA','production_specs','p2gc_reusable_demo_master.json');
const OVERRIDES=path.join(ROOT,'DATA','production_specs','p2gc_reusable_demo_copy_overrides_v3.json');
function replaceText(value,map){
  if(typeof value!=='string') return value;
  let out=value;
  for(const [from,to] of Object.entries(map||{})) out=out.split(from).join(to);
  return out;
}
function main(){
  const master=JSON.parse(fs.readFileSync(MASTER,'utf8').replace(/^\uFEFF/,''));
  const patch=JSON.parse(fs.readFileSync(OVERRIDES,'utf8').replace(/^\uFEFF/,''));
  master.version=patch.version||master.version;
  for(const scene of master.scenes||[]){
    const ov=patch.sceneOverrides?.[String(scene.scene)];
    if(!ov) continue;
    if(ov.title) scene.title=ov.title;
    if(Array.isArray(scene.screen)) scene.screen=scene.screen.map(x=>replaceText(x,ov.replaceScreen));
    if(scene.narration) scene.narration=replaceText(scene.narration,ov.replaceNarration);
  }
  fs.writeFileSync(MASTER,JSON.stringify(master,null,2),'utf8');
  console.log(JSON.stringify({ok:true,status:'P2GC_REUSABLE_DEMO_COPY_OVERRIDES_APPLIED',version:master.version,master:MASTER},null,2));
  return master;
}
if(require.main===module) main();
module.exports={main};
