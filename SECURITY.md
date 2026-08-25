# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for security issues. Do not open a
public issue for suspected credential exposure, pairing bypasses, authentication
failures, unsafe notification routing, or data leakage.

Do not include real credentials, pairing codes, push tokens, server addresses,
prompts, file contents, session identifiers, or broker databases in a report.
Use redacted logs and a minimal reproduction.

## Supported versions

The project is pre-1.0 and currently supports the latest revision of `main`.
Security fixes are not guaranteed to be backported to older preview builds.

## Trust boundaries

OpenCode2 Mobile connects directly to a user-controlled OpenCode server. A saved
connection has the same practical authority as that OpenCode deployment,
including the ability to execute tools as its server user.

Internet-facing OpenCode and broker endpoints must use HTTPS. Cleartext HTTP is
an explicit deployment and per-connection opt-in intended only for trusted local
networks or encrypted overlays such as Tailscale.

Notification pairing codes are two-minute bearer bootstrap secrets. Display a
code only in a trusted terminal, scan it immediately, and revoke unexpected
device registrations. Expo, APNs, and FCM receive generic text and encrypted
routing data, not OpenCode credentials.

OpenCode's built-in `/pair` QR is different: it contains the server's actual
Basic-auth password. Do not capture, log, or share it. The self-hosted broker's
public pairing route validates those credentials only against same-host,
allowlisted OpenCode ports and returns generic failures, but operators should
still restrict network access where practical.
