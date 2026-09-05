'use strict';

const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const ExecutiveGrowthBlueprintDemoService = require('./ExecutiveGrowthBlueprintDemoService');
const DemoTruthReconciliationService = require('./DemoTruthReconciliationService');
const ExecutiveBlueprintCanonicalTruthService = require('./ExecutiveBlueprintCanonicalTruthService');
const DemoCommercialPreviewService = require('./DemoCommercialPreviewService');
const SamPublicEntityIdentityService = require('./SamPublicEntityIdentityService');
const SamQualifiedProspectFallbackService = require('./SamQualifiedProspectFallbackService');
const SamQualifiedProspectNameResolver = require('./SamQualifiedProspectNameResolver');
const HistoricalRecipientNameIndexService = require('./HistoricalRecipientNameIndexService');
const HistoricalProspectFallbackService = require('./HistoricalProspectFallbackService');

const rootDir = path.resolve(workerData?.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
const term = String(workerData?.term || '').trim();
const refresh = workerData?.refresh === true;

function key(value) { return String(value || '').trim().toUpperCase(); }

function mergePublicSamIdentity(baseModel, identity) {
  if (!baseModel?.ok || !identity?.ok) return baseModel;
  const resolvedUei = key(baseModel.profile?.uei);
  const samUei = key(identity.uei);
  if (!resolvedUei || !samUei || resolvedUei !== samUei) return baseModel;
  return {
    ...baseModel,
    profile: {
      ...(baseModel.profile || {}),
      companyName: identity.legalBusinessName || baseModel.profile?.companyName || null,
      uei: identity.uei || baseModel.profile?.uei || null,
      cage: identity.cage || baseModel.profile?.cage || null,
      headquarters: baseModel.profile?.headquarters || identity.headquarters || null,
      website: baseModel.profile?.website || identity.website || null,
      naicsCodes: Array.from(new Set([...(baseModel.profile?.naicsCodes || []), ...(identity.naicsCodes || [])].filter(Boolean))),
      samStatus: identity.samStatus || 'UNVERIFIED',
      samExpirationCurrent: identity.samExpirationCurrent
    },
    currentState: {
      ...(baseModel.currentState || {}),
      samRegistration: identity.samRegistration
    },
    evidence: {
      ...(baseModel.evidence || {}),
      currentSamRegistration: identity.source || null
    }
  };
}

async function buildModel() {
  if (!term) return { ok:false, status:'TERM_REQUIRED' };

  const service = new ExecutiveGrowthBlueprintDemoService();
  const truthReconciler = new DemoTruthReconciliationService();
  const canonicalTruth = new ExecutiveBlueprintCanonicalTruthService({ rootDir });
  const commercialPreview = new DemoCommercialPreviewService();
  const samPublicIdentity = new SamPublicEntityIdentityService({ rootDir });
  const samFallback = new SamQualifiedProspectFallbackService({ rootDir });
  const samNameResolver = new SamQualifiedProspectNameResolver({ rootDir });
  const historicalNameIndex = new HistoricalRecipientNameIndexService({ rootDir });
  const historicalFallback = new HistoricalProspectFallbackService({ rootDir });

  try {
    let baseModel = service.build(term);
    if (!baseModel?.ok && baseModel?.status === 'CONTRACTOR_NOT_FOUND') {
      const publicIdentity = samPublicIdentity.resolve(term);
      if (publicIdentity?.ok) {
        baseModel = samPublicIdentity.toDemoModel(term, publicIdentity);
      } else {
        let fallback = samFallback.build(term);
        let canonicalIdentity = null;
        if (!fallback?.ok) {
          canonicalIdentity = samNameResolver.resolve(term);
          if (canonicalIdentity?.ok && canonicalIdentity.uei) fallback = samFallback.build(canonicalIdentity.uei);
        }
        if (fallback?.ok) {
          baseModel = {
            ...fallback,
            evidence: {
              ...(fallback.evidence || {}),
              canonicalNameResolution: canonicalIdentity?.ok ? {
                authority:'SAM_PUBLIC_BULK_QUALIFIED_UNIVERSE',
                matchedBy:canonicalIdentity.matchedBy,
                requestedTerm:term,
                legalName:canonicalIdentity.legalName,
                uei:canonicalIdentity.uei,
                cage:canonicalIdentity.cage || null
              } : null
            }
          };
        } else {
          const historicalIdentity = historicalNameIndex.resolve(term);
          if (historicalIdentity?.ok && historicalIdentity.row) {
            baseModel = historicalFallback.historicalModel(
              term,
              { ok:true, row:historicalIdentity.row, matchedBy:historicalIdentity.matchedBy },
              historicalFallback.sourceStatus()
            );
            baseModel = {
              ...baseModel,
              evidence: {
                ...(baseModel.evidence || {}),
                canonicalHistoricalNameResolution: {
                  authority:'USA_SPENDING_OFFICIAL_FY2026_VALIDATED_SIDECAR',
                  matchedBy:historicalIdentity.matchedBy,
                  requestedTerm:term,
                  legalName:historicalIdentity.legalName,
                  uei:historicalIdentity.uei,
                  indexStatus:historicalIdentity.indexStatus,
                  indexGeneratedAt:historicalIdentity.indexGeneratedAt
                }
              }
            };
          } else {
            baseModel = historicalFallback.build(term, { samFallback:fallback, canonicalIdentity, historicalIdentity, orionFailure:baseModel });
          }
        }
      }
    }

    if (baseModel?.ok && baseModel.profile?.uei) {
      const currentPublicSam = samPublicIdentity.resolve(baseModel.profile.uei);
      if (currentPublicSam?.ok) {
        baseModel = mergePublicSamIdentity(baseModel, currentPublicSam);
      } else {
        const currentSam = samFallback.build(baseModel.profile.uei);
        const resolvedUei = key(baseModel.profile.uei);
        const samUei = key(currentSam?.profile?.uei);
        if (currentSam?.ok === true && resolvedUei && samUei === resolvedUei) {
          baseModel = {
            ...baseModel,
            profile: {
              ...(baseModel.profile || {}),
              cage:currentSam.profile?.cage || baseModel.profile?.cage || null,
              website:baseModel.profile?.website || currentSam.profile?.website || null,
              samStatus:currentSam.profile?.samStatus || 'ACTIVE',
              samExpirationCurrent:currentSam.profile?.samExpirationCurrent === true || baseModel.profile?.samExpirationCurrent === true
            },
            currentState: {
              ...(baseModel.currentState || {}),
              samRegistration:currentSam.currentState?.samRegistration === false ? false : true
            },
            evidence: {
              ...(baseModel.evidence || {}),
              currentSamRegistration:currentSam.evidence?.identity || null
            }
          };
        }
      }
    }

    const reconciled = truthReconciler.reconcile(baseModel);
    const canonical = await canonicalTruth.hydrate(reconciled, { refresh });
    return commercialPreview.apply(canonical);
  } finally {
    try { samFallback.close?.(); } catch {}
    try { samNameResolver.close?.(); } catch {}
    try { historicalNameIndex.close?.(); } catch {}
    try { historicalFallback.close?.(); } catch {}
  }
}

buildModel()
  .then(model => parentPort.postMessage({ ok:true, model }))
  .catch(error => parentPort.postMessage({ ok:false, error:String(error?.stack || error?.message || error) }));
