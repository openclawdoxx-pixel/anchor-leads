"""Email pattern guessing — Hunter.io's business model, for free.

Given an owner name + website domain, generate likely email addresses
and verify them via MX record check. This produces PERSONAL emails
(bob@acmeplumbing.com) which convert 3-5x better than role addresses.

No page loads, no proxy needed. Pure DNS queries.
"""

import re
from urllib.parse import urlparse
from scraper.enrichment.email_verify import has_valid_mx, verify_email_free


def _extract_domain(website: str) -> str | None:
    """Pull the domain from a website URL."""
    if not website:
        return None
    if not website.startswith("http"):
        website = "https://" + website
    try:
        parsed = urlparse(website)
        domain = parsed.netloc.lower().replace("www.", "")
        if domain and "." in domain:
            return domain
    except Exception:
        pass
    return None


def _generate_patterns(first: str, last: str, domain: str) -> list[str]:
    """Generate common business email patterns from a name + domain."""
    f = first.lower().strip()
    l = last.lower().strip()

    patterns = [
        f"{f}@{domain}",                    # bob@domain.com
        f"{f}{l}@{domain}",                 # bobsmith@domain.com
        f"{f}.{l}@{domain}",               # bob.smith@domain.com
        f"{f[0]}{l}@{domain}",             # bsmith@domain.com
        f"{f}{l[0]}@{domain}",             # bobs@domain.com
        f"{f[0]}.{l}@{domain}",            # b.smith@domain.com
        f"{l}@{domain}",                    # smith@domain.com
        f"{f}_{l}@{domain}",               # bob_smith@domain.com
    ]
    return [p for p in patterns if re.match(r'^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$', p)]


def guess_email(owner_name: str, website: str) -> str | None:
    """Generate email guesses from owner name + website, verify via MX.

    Returns the first pattern that passes MX validation, or None.
    MX check only validates the DOMAIN can receive email — it doesn't
    verify the specific mailbox exists. But for small business domains
    with 1-3 mailboxes, the most common patterns (first@domain) are
    very likely correct.
    """
    if not owner_name or not website:
        return None

    domain = _extract_domain(website)
    if not domain:
        return None

    # Don't guess on freemail or social domains
    skip_domains = {
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
        "aol.com", "icloud.com", "me.com", "live.com", "msn.com",
        "yelp.com", "facebook.com", "instagram.com", "twitter.com",
        "youtube.com", "linkedin.com", "tiktok.com", "nextdoor.com",
        "thumbtack.com", "homeadvisor.com", "angi.com", "bbb.org",
        "yellowpages.com", "manta.com",
    }
    if domain in skip_domains or any(domain.endswith("." + d) for d in skip_domains):
        return None

    # Reject junk "owner names" that are actually section headers
    junk_names = {"our team", "our approach", "our staff", "our story",
                  "about us", "meet the team", "the team", "our family",
                  "our company", "about", "contact", "contact us"}
    if owner_name.lower().strip() in junk_names:
        return None

    # Check domain can receive email at all
    if not has_valid_mx(domain):
        return None

    # Split owner name into first/last
    parts = owner_name.strip().split()
    if len(parts) < 2:
        # Single name — limited patterns
        first = parts[0]
        patterns = [f"{first.lower()}@{domain}"]
    else:
        first = parts[0]
        last = parts[-1]
        patterns = _generate_patterns(first, last, domain)

    # Return the FIRST pattern — for small business domains, the most
    # common pattern (first@domain or first.last@domain) is almost always
    # correct. We can't SMTP-verify without risking blacklisting, so we
    # trust the MX validation + common pattern logic.
    #
    # Priority: bob@ > bobsmith@ > bob.smith@ > bsmith@
    return patterns[0] if patterns else None
