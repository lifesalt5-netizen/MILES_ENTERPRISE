# BUILD_038 Self Learning Layer

This build adds the MILES Self Learning Layer on top of the verified COO Loop and Executive Dashboard.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_038_SELF_LEARNING_LAYER\BUILD_038_SELF_LEARNING_LAYER"
powershell -ExecutionPolicy Bypass -File .\INSTALL_SELF_LEARNING.ps1
```

## Verify

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_038_SELF_LEARNING_LAYER\BUILD_038_SELF_LEARNING_LAYER"
powershell -ExecutionPolicy Bypass -File .\VERIFY_SELF_LEARNING.ps1
```

## Run

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_038_SELF_LEARNING_LAYER\BUILD_038_SELF_LEARNING_LAYER"
powershell -ExecutionPolicy Bypass -File .\RUN_SELF_LEARNING.ps1
```

## Outputs

- `DATA\self_learning\latest_learning_state.json`
- `DATA\self_learning\learning_history.json`
- `DATA\self_learning\learning_recommendations.json`
- `DATA\self_learning\self_learning_report.md`

## Services

- `LearningDataService.js`
- `DecisionLearningService.js`
- `FailureLearningService.js`
- `RoutingLearningService.js`
- `PriorityOptimizationService.js`
- `ConfidenceScoringService.js`
- `RecommendationEngineService.js`
- `SelfLearningService.js`
