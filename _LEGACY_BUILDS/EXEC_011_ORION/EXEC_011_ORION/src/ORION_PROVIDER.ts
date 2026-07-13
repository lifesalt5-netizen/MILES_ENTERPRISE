// EXEC_011 ORION Provider Controller
// All actions must be routed through EXEC_001 Unified Action Engine.

export const ORION_PROVIDER = {
  name: "ORION",
  status: "READY_READ_ONLY",
  capabilities: [
    "HealthCheck",
    "DatasetRefresh",
    "SegmentationRefresh",
    "ProfileRefresh",
    "RecommendationRefresh",
    "DataValidation",
    "ExecutiveReport",
    "MissionTriggers"
  ]
};
