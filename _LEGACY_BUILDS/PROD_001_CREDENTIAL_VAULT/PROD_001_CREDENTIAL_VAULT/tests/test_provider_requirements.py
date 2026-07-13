from src.provider_requirements import PROVIDER_REQUIREMENTS

def test_required_providers_present():
    for provider in ["ORION", "INSTANTLY", "GOOGLE_WORKSPACE", "NAMECHEAP", "WEBSITE"]:
        assert provider in PROVIDER_REQUIREMENTS
