from bemse.verification import VerificationStatus, verify_email


def test_invalid_syntax_is_rejected():
    result = verify_email("not-an-email", check_mx=False)
    assert result.status == VerificationStatus.INVALID
    assert result.confidence == 0
    assert "invalid_syntax" in result.reasons


def test_disposable_domain_is_risky_or_invalid():
    result = verify_email("person@mailinator.com", check_mx=False)
    assert result.disposable is True
    assert result.confidence <= 60
    assert result.status in {VerificationStatus.RISKY, VerificationStatus.INVALID}


def test_role_account_is_flagged():
    result = verify_email("info@example.com", check_mx=False)
    assert result.role_account is True
    assert result.confidence == 90


def test_normal_address_passes_v1_checks_when_mx_check_disabled():
    result = verify_email("person@example.com", check_mx=False)
    assert result.status == VerificationStatus.VALID
    assert result.confidence == 100
