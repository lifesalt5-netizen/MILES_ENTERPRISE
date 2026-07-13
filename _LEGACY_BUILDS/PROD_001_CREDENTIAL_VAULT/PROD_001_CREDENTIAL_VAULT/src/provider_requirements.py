PROVIDER_REQUIREMENTS = {
    "ORION": {
        "required_env": ["ORION_DB_PATH"],
        "known_default": r"D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db",
        "description": "ORION SQLite database path"
    },
    "INSTANTLY": {
        "required_env": ["INSTANTLY_API_KEY"],
        "description": "Instantly API key for live provider access"
    },
    "GOOGLE_WORKSPACE": {
        "required_env": [
            "GOOGLE_WORKSPACE_CUSTOMER_ID",
            "GOOGLE_SERVICE_ACCOUNT_FILE",
            "GOOGLE_DELEGATED_ADMIN"
        ],
        "description": "Google Admin SDK service account with domain-wide delegation"
    },
    "NAMECHEAP": {
        "required_env": [
            "NAMECHEAP_API_USER",
            "NAMECHEAP_API_KEY",
            "NAMECHEAP_CLIENT_IP",
            "NAMECHEAP_USERNAME"
        ],
        "description": "Namecheap API credentials and authorized client IP"
    },
    "WEBSITE": {
        "required_env": [
            "WEBSITE_BASE_URL",
            "WEBSITE_ADMIN_MODE",
            "WEBSITE_AUTH_METHOD"
        ],
        "description": "Website provider access configuration"
    }
}
