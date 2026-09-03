'use strict';

function clean(v){ return String(v == null ? '' : v).trim(); }
function arr(v){ return Array.isArray(v) ? v.filter(Boolean) : []; }
function uniq(v){ return [...new Set(arr(v).map(clean).filter(Boolean))]; }
function norm(v){ return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }

function recompeteCountFromText(text){
  const m=clean(text).match(/prioriti[sz]e\s+(\d+)\s+recompete/i);
  return m ? Number(m[1]) : null;
}
function hasVerifiedCurrentVehicle(model){
  return arr(model?.profile?.contractVehicles).length>0 || arr(model?.currentState?.contractVehicles).length>0 || arr(model?.vehicles?.current).length>0;
}
function broaderVehicleInventoryConfirmed(model){
  return /CONFIRMED/i.test(clean(model?.vehicles?.inventoryStatus || model?.vehicleInventory?.status));
}
function masNonHolderOnly(model){
  return /CURRENT GSA MAS NON-HOLDER/i.test(clean(model?.profile?.gsaStatus || model?.vehicles?.status)) && !broaderVehicleInventoryConfirmed(model);
}
function structuredRevenueModelConfirmed(model){
  const status=norm(model?.revenue?.opportunity?.status);
  return /STRUCTURED/.test(status) && /PROVENANCE/.test(status) && /CONFIRMED|SUPPORTED/.test(status);
}

function rejectRecommendation(text,model){
  const t=clean(text);
  const recompetes=arr(model?.opportunities?.recompetes);
  const explicitRecompeteCount=recompeteCountFromText(t);
  if(explicitRecompeteCount!=null && explicitRecompeteCount!==recompetes.length) return true;
  if(!recompetes.length && /recompete|incumbent[- ]?displacement/i.test(t) && /prioriti[sz]e|target|signal/i.test(t)) return true;

  const hasVehicle=hasVerifiedCurrentVehicle(model);
  const vehicleUnknown=masNonHolderOnly(model) || (!hasVehicle && !broaderVehicleInventoryConfirmed(model));
  if((hasVehicle || vehicleUnknown) && /vehicle gap contractor|primary growth driver:\s*vehicle gap|activate and expand contract vehicle coverage|activate existing schedules?|no contract vehicle|missing vehicle|multiple vehicle coverage/i.test(t)) return true;

  if(!structuredRevenueModelConfirmed(model) && /revenue leakage|commercial pain point.*\$|modeled (potential )?revenue.*\$/i.test(t)) return true;
  return false;
}

function apply(model){
  if(!model || model.ok!==true) return model;
  const recommendations=model.recommendations||{};
  for(const key of ['immediate','vehicle','agency','partner','opportunity','growth']) recommendations[key]=arr(recommendations[key]).filter(x=>!rejectRecommendation(x,model));
  if(model.vehicles) model.vehicles.recommendations=arr(model.vehicles.recommendations).filter(x=>!rejectRecommendation(x,model));
  if(model.primePartners) model.primePartners.strategy=arr(model.primePartners.strategy).filter(x=>!rejectRecommendation(x,model));
  if(model.subcontracting) model.subcontracting.strategy=arr(model.subcontracting.strategy).filter(x=>!rejectRecommendation(x,model));
  if(model.gaps) model.gaps.items=arr(model.gaps.items).filter(x=>!rejectRecommendation(x,model));

  const recompetes=arr(model?.opportunities?.recompetes);
  if(recompetes.length){
    recommendations.growth=uniq([...arr(recommendations.growth),`Prioritize ${recompetes.length} validated recompete signal${recompetes.length===1?'':'s'} against value, timing and demonstrated capability before pursuit.`]);
  }
  if(hasVerifiedCurrentVehicle(model)){
    recommendations.vehicle=uniq([...arr(recommendations.vehicle),'Map verified current vehicle scope to qualified demand before recommending any additional vehicle investment.']);
  } else if(masNonHolderOnly(model)) {
    recommendations.vehicle=uniq([...arr(recommendations.vehicle),'Complete broader federal vehicle inventory validation before recommending a vehicle acquisition or access strategy.']);
  }

  model.recommendations=recommendations;
  model.evidence=model.evidence||{};
  model.evidence.recommendationIntegrity={
    status:'CANONICAL_RECOMMENDATION_INTEGRITY_ENFORCED',
    rules:[
      'RECOMPETE_RECOMMENDATION_COUNT_MUST_EQUAL_CANONICAL_SIGNAL_COUNT',
      'MAS_NON_HOLDER_DOES_NOT_PROVE_NO_OTHER_VEHICLE',
      'GENERIC_VEHICLE_GAP_LANGUAGE_REQUIRES_BROADER_VEHICLE_TRUTH',
      'REVENUE_LEAKAGE_MESSAGING_REQUIRES_STRUCTURED_PROVENANCE_CONFIRMED_MODEL'
    ]
  };
  return model;
}

module.exports={apply,rejectRecommendation,recompeteCountFromText,hasVerifiedCurrentVehicle,masNonHolderOnly,structuredRevenueModelConfirmed};
