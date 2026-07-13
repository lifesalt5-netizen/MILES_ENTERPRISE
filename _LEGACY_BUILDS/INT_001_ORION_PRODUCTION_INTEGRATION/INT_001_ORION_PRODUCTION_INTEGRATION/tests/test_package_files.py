from pathlib import Path

def test_manifest_exists():
    assert Path("MANIFEST.json").exists()

def test_runner_exists():
    assert Path("src/run_orion_health.py").exists()
