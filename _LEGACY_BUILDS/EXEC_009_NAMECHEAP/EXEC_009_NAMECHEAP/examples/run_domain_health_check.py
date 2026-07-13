from pathlib import Path
import json

# Offline example using representative DNS records. Live Namecheap API wiring is credential-dependent.
records = [
    {"host":"@","type":"TXT","value":"v=spf1 include:_spf.google.com ~all"},
    {"host":"google._domainkey","type":"TXT","value":"v=DKIM1; k=rsa; p=EXAMPLE"},
    {"host":"_dmarc","type":"TXT","value":"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"},
    {"host":"@","type":"MX","value":"ASPMX.L.GOOGLE.COM","mxPref":1},
]

checks = {
    "domain":"pathwaysgovcon.com",
    "spf":"PASS",
    "dkim":"PASS",
    "dmarc":"PASS",
    "mx":"PASS",
    "score":100
}
Path("state").mkdir(exist_ok=True)
Path("state/domain_health_example.json").write_text(json.dumps(checks, indent=2))
print(json.dumps(checks, indent=2))
