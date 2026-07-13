import { calculateDomainHealth } from '../src/HEALTH';

const records = [
  { host: '@', type: 'TXT' as const, value: 'v=spf1 include:_spf.google.com ~all' },
  { host: 'google._domainkey', type: 'TXT' as const, value: 'v=DKIM1; k=rsa; p=EXAMPLE' },
  { host: '_dmarc', type: 'TXT' as const, value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com' },
  { host: '@', type: 'MX' as const, value: 'ASPMX.L.GOOGLE.COM', mxPref: 1 }
];

console.log(JSON.stringify(calculateDomainHealth('pathwaysgovcon.com', records), null, 2));
