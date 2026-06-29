# Security Policy

OpenBucket implements authentication (AWS SigV4), an admin JWT surface, at-rest
encryption, and object-lock retention. We take security reports seriously.

## Supported versions

OpenBucket is pre-1.0. Security fixes land on `main` and in the latest published
release of `@openbucket/nestjs`. Please test against the latest version before
reporting.

| Version            | Supported |
| ------------------ | --------- |
| `main` / latest    | ✅        |
| older `0.x` tags   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via either:

1. **GitHub Security Advisories** — [open a draft advisory](https://github.com/ProjectBay/openbucket/security/advisories/new)
   (preferred; keeps the report private and coordinated).
2. **Email** — **daniel@projectbay.io** with the subject `OpenBucket security`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal proof-of-concept is ideal).
- Affected version(s) / commit, and configuration relevant to the issue.

### What to expect

- **Acknowledgement** within 3 business days.
- An assessment and a target remediation timeline within 10 business days.
- Coordinated disclosure: we will agree on a public-disclosure date with you,
  credit you in the advisory (unless you prefer to remain anonymous), and
  publish a fix and advisory together.

## Scope notes

- OpenBucket is single-tenant in its current form: the root S3 credentials and
  the admin account are fully privileged by design. Reports about a holder of
  valid root/admin credentials performing privileged actions are out of scope.
- The standalone deployment expects to sit behind a TLS-terminating reverse
  proxy. Plaintext-HTTP concerns that assume no proxy are out of scope.
- Findings in third-party dependencies should generally be reported upstream;
  we still want to hear about them so we can pin/patch.
