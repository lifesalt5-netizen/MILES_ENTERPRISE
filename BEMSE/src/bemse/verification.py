from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from typing import Iterable

import dns.resolver

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

DISPOSABLE_DOMAINS = {
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "tempmail.com",
    "yopmail.com",
}

ROLE_LOCAL_PARTS = {
    "admin", "billing", "contact", "hello", "info", "marketing", "office",
    "sales", "support", "webmaster",
}


class VerificationStatus(str, Enum):
    VALID = "valid"
    RISKY = "risky"
    INVALID = "invalid"


@dataclass(slots=True)
class VerificationResult:
    email: str
    status: VerificationStatus
    confidence: int
    syntax_valid: bool
    mx_valid: bool
    disposable: bool
    role_account: bool
    reasons: list[str]


def _domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower().strip()


def _local(email: str) -> str:
    return email.split("@", 1)[0].lower().strip()


def has_mx(domain: str) -> bool:
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=3.0)
        return bool(list(answers))
    except Exception:
        return False


def verify_email(email: str, *, check_mx: bool = True) -> VerificationResult:
    normalized = email.strip().lower()
    reasons: list[str] = []
    syntax_valid = bool(EMAIL_RE.match(normalized))

    if not syntax_valid:
        return VerificationResult(
            email=normalized,
            status=VerificationStatus.INVALID,
            confidence=0,
            syntax_valid=False,
            mx_valid=False,
            disposable=False,
            role_account=False,
            reasons=["invalid_syntax"],
        )

    domain = _domain(normalized)
    local = _local(normalized)
    disposable = domain in DISPOSABLE_DOMAINS
    role_account = local in ROLE_LOCAL_PARTS
    mx_valid = has_mx(domain) if check_mx else True

    score = 100
    if not mx_valid:
        score -= 70
        reasons.append("no_mx")
    if disposable:
        score -= 40
        reasons.append("disposable_domain")
    if role_account:
        score -= 10
        reasons.append("role_account")

    score = max(0, min(100, score))
    if not mx_valid or score < 40:
        status = VerificationStatus.INVALID
    elif score < 80:
        status = VerificationStatus.RISKY
    else:
        status = VerificationStatus.VALID

    if not reasons:
        reasons.append("passed_v1_checks")

    return VerificationResult(
        email=normalized,
        status=status,
        confidence=score,
        syntax_valid=syntax_valid,
        mx_valid=mx_valid,
        disposable=disposable,
        role_account=role_account,
        reasons=reasons,
    )


def verify_batch(emails: Iterable[str], *, check_mx: bool = True) -> list[VerificationResult]:
    return [verify_email(email, check_mx=check_mx) for email in emails]
