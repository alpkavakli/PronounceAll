# Security policy

PronounceAll handles learner accounts and personal data, and the maintainer
takes reports seriously. Thank you for helping keep it safe.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/alpkavakli/PronounceAll/security/advisories/new)
on this repository. If that is unavailable to you, email the maintainer at
`security@pronounceall.com`.

Please include, as far as you can:

- the affected component, endpoint, or file;
- what an attacker gains — the impact, not only the defect;
- reproduction steps or a proof of concept;
- any suggested remediation.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | within 3 working days |
| Initial assessment and severity | within 7 working days |
| Fix or documented mitigation for a high-severity issue | within 30 days |
| Coordinated public disclosure | within 90 days of the report, or sooner once a fix has shipped |

PronounceAll is maintained by one person, so these are honest targets rather
than a contractual SLA. If a deadline is going to slip, you will be told before
it does, not after.

Reporters are credited in the advisory and the release notes unless they ask
not to be. There is no bug bounty; the project has no revenue.

## Scope

In scope: this repository's source, its dependencies as used here, and the
production deployment at `pronounceall.com`.

Out of scope: findings against third-party services the project consumes
(report those to their own maintainers), volumetric denial of service, social
engineering of the maintainer, and reports from automated scanners with no
demonstrated impact.

## Safe harbour

Good-faith research under this policy is welcome, and the maintainer will not
pursue action over it. Please stay within scope, use only accounts you own or
have permission to test, avoid degrading the service for others, and do not
access, modify, or retain other people's data — if you encounter personal data,
stop and say so in your report.
