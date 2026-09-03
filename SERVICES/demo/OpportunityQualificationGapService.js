'use strict';

function clean(v){ return String(v == null ? '' : v).trim(); }
function norm(v){ return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function uniq(values){ return [...new Set((Array.isArray(values)?values:[]).filter(Boolean))]; }

function capabilityRequirement(title, scopeClass){
  const text=norm(title);
  const rules=[
    [/SIGN LANGUAGE|\bASL\b/,'American Sign Language interpretation capability'],
    [/INTERPRET|INTERPRETER|TRANSLAT|LANGUAGE SERVICE/,'language interpretation/translation capability'],
    [/GENERATOR/,'generator maintenance/repair capability'],
    [/ELECTRICAL/,'licensed/qualified electrical maintenance capability'],
    [/HVAC/,'HVAC maintenance/repair capability'],
    [/PLUMB/,'plumbing maintenance/repair capability'],
    [/MECHANICAL REPAIR|EQUIPMENT REPAIR/,'specialized mechanical/equipment repair capability'],
    [/PREVENTIVE MAINTENANCE|MAINTENANCE AND REPAIR/,'the specific preventive-maintenance/repair capability required by the solicitation'],
    [/CYBER/,'cybersecurity capability applicable to the solicitation scope'],
    [/DATABASE/,'database engineering/administration capability'],
    [/SOFTWARE|APPLICATION/,'software/application development or support capability'],
    [/WAREHOUS/,'warehousing capability'],
    [/DISTRIBUT/,'distribution capability'],
    [/FREIGHT|TRANSPORT|DELIVERY/,'transportation/logistics delivery capability'],
    [/FRUIT|VEGETABLE|FOOD|PRODUCE|BEAN|GRAIN|AGRICULT|COMMODIT/,'agriculture/food commodity sourcing and fulfillment capability'],
    [/TRAINING|SEMINAR|INSTRUCTION|EDUCATION/,'training/instructional delivery capability']
  ];
  for (const [re,label] of rules) if (re.test(text)) return label;
  const cls=clean(scopeClass);
  if (cls==='SPECIALIZED_MAINTENANCE') return 'the specialized maintenance/repair capability required by the solicitation';
  if (cls==='LANGUAGE_INTERPRETATION') return 'the interpretation/language-service capability required by the solicitation';
  if (cls==='FACILITIES_SUPPORT_GENERAL') return 'the specific technical facilities-support capability required by the solicitation';
  return 'documented scope-relevant capability or past performance for the solicitation';
}

function gapClosureOptions(gapType, label){
  if (gapType==='CAPABILITY') return [
    `Confirm the company already has ${label} and add current evidence to the profile`,
    `Add a qualified subcontractor or teaming partner that provides ${label}`,
    `Add qualified personnel/licensing/certification needed to perform ${label}, where commercially and legally appropriate`,
    'If the gap cannot be closed credibly before proposal due date, do not recommend direct pursuit'
  ];
  if (gapType==='SET_ASIDE_ELIGIBILITY') return [
    'Verify current authoritative eligibility/certification evidence',
    'If direct eligibility is unavailable, evaluate a lawful prime/sub/JV/mentor-protege or other permitted teaming structure',
    'Do not represent the company as directly eligible until authoritative evidence confirms it'
  ];
  if (gapType==='VEHICLE_ACCESS') return [
    'Verify whether the company already holds the required contract vehicle or ordering-channel access',
    'Evaluate a qualified vehicle-holding prime/team partner when the solicitation permits it',
    'Do not recommend vehicle investment unless the opportunity pipeline justifies it'
  ];
  return ['Validate the missing requirement against authoritative solicitation and company evidence before pursuit.'];
}

function analyze({ title, capability, setAsideFit, vehicleAccessBlocked=false, additionalGaps=[] }={}){
  const gaps=[];
  if (capability?.directFit !== true) {
    const label=capabilityRequirement(title, capability?.scopeClass);
    gaps.push({
      type:'CAPABILITY',
      code:'DEMONSTRATED_CAPABILITY_NOT_YET_PROVEN',
      requirement:label,
      evidenceStatus:'NOT_PROVEN_IN_CURRENT_COMPANY_EVIDENCE',
      closureOptions:gapClosureOptions('CAPABILITY',label)
    });
  }
  if (setAsideFit?.eligibilityBlocked === true) {
    gaps.push({
      type:'SET_ASIDE_ELIGIBILITY',
      code:'DIRECT_SET_ASIDE_ELIGIBILITY_NOT_CONFIRMED',
      requirement:clean(setAsideFit.reason) || 'current set-aside eligibility evidence',
      evidenceStatus:'NOT_CONFIRMED',
      closureOptions:gapClosureOptions('SET_ASIDE_ELIGIBILITY')
    });
  }
  if (vehicleAccessBlocked === true) {
    gaps.push({
      type:'VEHICLE_ACCESS',
      code:'REQUIRED_VEHICLE_ACCESS_NOT_CONFIRMED',
      requirement:'required acquisition vehicle/order-channel access',
      evidenceStatus:'NOT_CONFIRMED',
      closureOptions:gapClosureOptions('VEHICLE_ACCESS')
    });
  }
  for (const gap of Array.isArray(additionalGaps)?additionalGaps:[]) if (gap) gaps.push(gap);

  const materialGapCount=gaps.length;
  const singleGap=materialGapCount===1 ? gaps[0] : null;
  const nearFit=materialGapCount===1;
  let state='FULL_QUALIFICATION_REQUIRES_SOLICITATION_REQUIREMENT_VALIDATION';
  if (materialGapCount===0 && capability?.directFit===true && setAsideFit?.eligibilityBlocked!==true && vehicleAccessBlocked!==true) state='PRELIMINARY_DIRECT_FIT_SUPPORTED';
  else if (nearFit && singleGap?.type==='CAPABILITY') state='NEAR_FIT_SINGLE_CAPABILITY_GAP';
  else if (nearFit && singleGap?.type==='SET_ASIDE_ELIGIBILITY') state='NEAR_FIT_SINGLE_ELIGIBILITY_GAP';
  else if (nearFit && singleGap?.type==='VEHICLE_ACCESS') state='NEAR_FIT_SINGLE_ACCESS_GAP';
  else if (materialGapCount>1) state='MULTIPLE_QUALIFICATION_GAPS';

  return {
    state,
    materialGapCount,
    nearFit,
    singleGap,
    gaps,
    missingRequirements:uniq(gaps.map(g=>g.requirement)),
    closureOptions:uniq(gaps.flatMap(g=>Array.isArray(g.closureOptions)?g.closureOptions:[])),
    rule:'A discovered opportunity is not fully qualified until solicitation-specific requirements are compared against authoritative company evidence. Near-fit opportunities remain visible when a discrete gap may be closable, but the gap and closure path must be explicit.'
  };
}

module.exports={ analyze, capabilityRequirement, gapClosureOptions };
