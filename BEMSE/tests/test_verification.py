import bemse.verification as verification
from bemse.verification import MailRouteStatus, VerificationStatus, verify_email


def test_invalid_syntax_is_rejected():
    result = verify_email("not-an-email", check_mx=False)
    assert result.status == VerificationStatus.INVALID
    assert result.confidence == 0
    assert result.mail_route == MailRouteStatus.UNCHECKED
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
    assert result.mail_route == MailRouteStatus.UNCHECKED


def test_dns_temporary_error_is_risky_not_invalid(monkeypatch):
    monkeypatch.setattr(
        verification,
        "resolve_mail_route",
        lambda _domain: MailRouteStatus.DNS_TEMP_ERROR,
    )
    result = verify_email("person@example.com")
    assert result.status == VerificationStatus.RISKY
    assert result.confidence == 65
    assert "dns_temporary_error" in result.reasons


def test_null_mx_is_hard_invalid(monkeypatch):
    monkeypatch.setattr(
        verification,
        "resolve_mail_route",
        lambda _domain: MailRouteStatus.NULL_MX,
    )
    result = verify_email("person@example.com")
    assert result.status == VerificationStatus.INVALID
    assert result.confidence == 0
    assert "null_mx_domain_does_not_accept_mail" in result.reasons


def test_implicit_mx_via_address_record_is_supported(monkeypatch):
    monkeypatch.setattr(
        verification,
        "resolve_mail_route",
        lambda _domain: MailRouteStatus.IMPLICIT_A,
    )
    result = verify_email("person@example.com")
    assert result.status == VerificationStatus.VALID
    assert result.confidence == 90
    assert result.mx_valid is True
    assert "implicit_mx_via_address_record" in result.reasons
