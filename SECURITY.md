# Security

The nano133 Kit's packages handle payments, sign-ins and, for some tools, a
wallet's key on your server. We take reports seriously.

## Report a vulnerability

Report it privately through GitHub: open the **Security** tab of this
repository and choose **Report a vulnerability**
(https://github.com/nano133-com/kit/security/advisories/new).

Please do not open a public issue, pull request or discussion for a
vulnerability, and do not test against nano133.com or its node.

Include the package and version, what an attacker could do, and the steps to
reproduce it (a test on the package's mock ledger is ideal). We answer within
7 days and publish a fixed version and an advisory once it is fixed.

## Supported versions

The newest version of each package gets security fixes.

## Advisories

Each fixed vulnerability has an advisory:
https://github.com/nano133-com/kit/security/advisories

| Date | Package | Fixed in | Advisory |
|---|---|---|---|
| 2026-10-09 | `@nano133/signin` 0.1.0 to 0.2.0 | 0.2.1 | [GHSA-jr9h-hjpf-6wm2](https://github.com/nano133-com/kit/security/advisories/GHSA-jr9h-hjpf-6wm2): a signature sign-in accepted an address with a wrong checksum. Update to 0.2.1. |
