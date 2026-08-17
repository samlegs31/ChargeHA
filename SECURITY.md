# Security policy

Security matters because E.V. Solar can control vehicle charging and stores configuration for energy and vehicle integrations.

## Supported code

Security fixes are applied to the current `main` branch and to the latest maintained E.V. Solar release when applicable.

Older experimental branches, archived branches and development snapshots should not be considered security-supported deployments.

## Reporting a vulnerability

Please **do not disclose exploitable security vulnerabilities publicly before a fix is available**.

If GitHub shows a **Report a vulnerability** option in the repository Security tab, use that private reporting channel. Otherwise, contact the repository owner through a private channel before public disclosure.

When reporting an issue, include:

- the affected version or commit;
- the affected component;
- clear reproduction steps;
- the security impact;
- whether credentials, tokens or private keys may have been exposed.

Never include real Tesla tokens, Solar.web credentials, encryption keys, private keys or other live secrets in a public report.

## Secrets that must never be committed

Do not commit or publish:

- Tesla access or refresh tokens;
- Tesla Fleet API client secrets;
- Tesla private keys;
- Solar.web or Fronius account credentials;
- the E.V. Solar encryption key;
- session secrets or authentication credentials;
- production `.env` files;
- databases or backups containing installation-specific secrets.

If a secret is accidentally committed, treat it as compromised and rotate/revoke it even if the commit is later deleted.

## Deployment guidance

E.V. Solar is intended to run behind appropriate authentication and network controls.

- Do not expose the application directly to the public Internet without HTTPS and suitable authentication.
- Keep the encryption key outside the Git repository and back it up separately.
- Run containers with the least privileges required.
- Keep the operating system, Docker runtime and dependencies patched.
- Back up the application database and encryption key independently of GitHub.

## Source and licence

E.V. Solar is distributed under the GNU Affero General Public License v3.0. The corresponding source for this project is maintained in this repository.

See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md) for licence and attribution information.
