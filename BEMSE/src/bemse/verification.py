from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from typing import Iterable

import dns.exception
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


class MailRouteStatus(str, Enum):
    EXPLICIT_MX = "explicit_mx"
    IMPLICIT_A = "implicit_a"
    NULL_MX = "null_mx"
    NO_ROUTE = "no_route"
    DNS_TEMP_ERROR = "dns_temp_error"
    UNCHECKED = "unchecked"


@dataclass(slots=True)
class VerificationResult:
    email: str
    status: VerificationStatus
    confidence: int
    syntax_valid: bool
    mx_valid: bool
    mail_route: MailRouteStatus
    disposable: bool
    role_account: bool
    reasons: list[str]


def _domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower().strip().rstrip(".")


def _local(email: str) -> str:
    return email.split("@", 1)[0].lower().strip()


def resolve_mail_route(domain: str) -> MailRouteStatus:
    """Resolve whether a domain can receive SMTP mail without false-invalidating transient DNS failures.

    SMTP permits an implicit MX when a domain has no explicit MX but does have an A/AAAA
    record. A null MX (RFC 7505) explicitly signals that the domain does not accept email.
    Resolver timeouts and transient nameserver failures are classified as temporary risk,
    not as proof that an address is invalid.
    """
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=3.0)
        exchanges = [str(answer.exchange).rstrip(".") for answer in answers]
        if any(exchange == "" for exchange in exchanges):
            return MailRouteStatus.NULL_MX
        if exchanges:
            return MailRouteStatus.EXPLICIT_MX
    except dns.resolver.NXDOMAIN:
        return MailRouteStatus.NO_ROUTE
    except dns.resolver.NoAnswer:
        pass
    except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.resolver.LifetimeTimeout):
        return MailRouteStatus.DNS_TEMP_ERROR
    except dns.exception.DNSException:
        return MailRouteStatus.DNS_TEMP_ERROR

    # RFC 5321 implicit-MX fallback: if no MX exists, an address record can still be a route.
    for record_type in ("A", "AAAA"):
        try:
            answers = dns.resolver.resolve(domain, record_type, lifetime=3.0)
            if list(answers):
                return MailRouteStatus.IMPLICIT_A
        except dns.resolver.NXDOMAIN:
            return MailRouteStatus.NO_ROUTE
        except dns.resolver.NoAnswer:
            continue
        except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.resolver.LifetimeTimeout):
            return MailRouteStatus.DNS_TEMP_ERROR
        except dns.exception.DNSException:
            return MailRouteStatus.DNS_TEMP_ERROR

    return MailRouteStatus.NO_ROUTE


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
            mail_route=MailRouteStatus.UNCHECKED,
            disposable=False,
            role_account=False,
            reasons=["invalid_syntax"],
        )

    domain = _domain(normalized)
    local = _local(normalized)
    disposable = domain in DISPOSABLE_DOMAINS
    role_account = local in ROLE_LOCAL_PARTS
    mail_route = resolve_mail_route(domain) if check_mx else MailRouteStatus.UNCHECKED
    mx_valid = mail_route in {
        MailRouteStatus.EXPLICIT_MX,
        MailRouteStatus.IMPLICIT_A,
        MailRouteStatus.UNCHECKED,
    }

    score = 100
    hard_invalid = False

    if mail_route == MailRouteStatus.IMPLICIT_A:
        score -= 10
        reasons.append("implicit_mx_via_address_record")
    elif mail_route == MailRouteStatus.NULL_MX:
        score -= 100
        hard_invalid = True
        reasons.append("null_mx_domain_does_not_accept_mail")
    elif mail_route == MailRouteStatus.NO_ROUTE:
        score -= 100
        hard_invalid = True
        reasons.append("no_mail_route")
    elif mail_route == MailRouteStatus.DNS_TEMP_ERROR:
        score -= 35
        reasons.append("dns_temporary_error")

    if disposable:
        score -= 40
        reasons.append("disposable_domain")
    if role_account:
        score -= 10
        reasons.append("role_account")

    score = max(0, min(100, score))
    if hard_invalid:
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
        mail_route=mail_route,
        disposable=disposable,
        role_account=role_account,
        reasons=reasons,
    )


def verify_batch(emails: Iterable[str], *, check_mx: bool = True) -> list[VerificationResult]:
    return [verify_email(email, check_mx=check_mx) for email in emails]
