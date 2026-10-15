# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | ✅ active          |
| 0.0.x   | ⚠️ best-effort only |

wavecode is a single-person hobby project maintained by [Petr Kosov](https://github.com/11111000000). Security fixes are released as fast as possible after a confirmed report, with priority on the latest version.

## Reporting a Vulnerability

**Please do NOT file a public GitHub issue for security vulnerabilities.**

Use one of these channels (in order of preference):

1. **GitHub Security Advisories** — click "Report a vulnerability" on the [Security tab](https://github.com/11111000000/wavecode/security/advisories/new). This is private and tracked.
2. **Email** — `wavecode-security@kosov.online` (PGP key: see keyserver).

Please include:

- Affected version (commit SHA or tag)
- Reproduction steps
- Impact assessment (what can an attacker do?)
- Optional: a proposed fix

## Response Timeline

| Step | SLA |
|------|-----|
| Initial acknowledgement | within 7 days |
| Triage + severity assessment | within 14 days |
| Patch for critical issues | within 30 days |
| Patch for high/medium | within 60 days |
| Public disclosure | after fix is shipped + 30 days, or by mutual agreement |

## What counts as a vulnerability

In scope:

- XSS in score file (e.g. via Strudel eval of attacker-controlled code) — by design, **running code is the point**; report only if the user can be tricked into running code without their consent
- LLM prompt injection that escapes the score-update context and modifies the user's IndexedDB without authorization
- IndexedDB data leakage via same-origin policy bypass
- ServiceWorker cache poisoning (e.g. via manipulated responses during SW update)
- Dependency vulnerabilities with exploitable impact (RCE, XSS, prototype pollution)

Out of scope:

- Self-XSS (the user runs code in their own browser, on their own score — that's the design)
- "LLM said something bad" — model output is user-facing, not a security boundary
- Browser autoplay policy workarounds
- Best-practice recommendations (file those as feature requests)

## Recognition

We follow a [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) model. With your permission, you'll be credited in the fix's commit message and `CHANGELOG.md`.
