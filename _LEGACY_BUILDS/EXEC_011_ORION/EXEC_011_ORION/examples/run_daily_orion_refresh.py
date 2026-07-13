# Example: Daily ORION Refresh mission payload

mission = {
    "mission_name": "Daily ORION Refresh",
    "provider": "ORION",
    "tasks": [
        "HealthCheck",
        "DatasetRefresh",
        "DataValidation",
        "SegmentationRefresh",
        "ProfileRefresh",
        "RecommendationRefresh",
        "ExecutiveReport"
    ]
}

print(mission)
