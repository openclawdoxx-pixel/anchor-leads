"""Free email verification via MX record + syntax checks.

This catches ~20-30% of bad emails (dead domains, typos). For full
verification use a paid service like MillionVerifier before sending.
"""

import re
import dns.resolver

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# Cache MX lookups so we don't re-query the same domain 50 times
_mx_cache: dict[str, bool] = {}


def has_valid_mx(domain: str) -> bool:
    """Check if a domain has valid MX records (can receive email)."""
    if domain in _mx_cache:
        return _mx_cache[domain]
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=5.0)
        valid = len(answers) > 0
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN,
            dns.resolver.NoNameservers, dns.exception.Timeout,
            Exception):
        valid = False
    _mx_cache[domain] = valid
    return valid


def verify_email_free(email: str) -> str:
    """Returns 'valid', 'invalid_syntax', 'invalid_domain', or 'unknown'."""
    if not email or not EMAIL_RE.match(email):
        return "invalid_syntax"

    domain = email.split("@")[1].lower()

    # Known bad TLDs
    if domain.endswith((".local", ".internal", ".test", ".example")):
        return "invalid_domain"

    if not has_valid_mx(domain):
        return "invalid_domain"

    return "valid"


def batch_verify(emails: list[str]) -> dict[str, list[str]]:
    """Verify a list of emails. Returns {status: [emails]}."""
    results: dict[str, list[str]] = {"valid": [], "invalid_syntax": [], "invalid_domain": [], "unknown": []}
    for email in emails:
        status = verify_email_free(email)
        results[status].append(email)
    return results
