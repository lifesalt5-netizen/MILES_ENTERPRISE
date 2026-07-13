def test_manifest_exists():
    from pathlib import Path
    assert Path('MANIFEST.json').exists() or Path('../MANIFEST.json').exists()
