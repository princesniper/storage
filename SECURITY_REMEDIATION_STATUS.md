# Security remediation status — local only

Scope approved: SEC-001 through SEC-004 and PROD-001 through PROD-004. No production configuration changes, database migrations, secret rotations, commits, pushes, or deployments are authorized by this task.

## Implemented locally

- SEC-001: Added login throttling per client address and normalized account identifier using `RATE_LIMIT_LOGIN_PER_15MIN`.
- SEC-002: Added opportunistic cleanup of resumable upload directories older than 24 hours, plus rate limits on session creation, chunk transfer, and completion.
- SEC-003: Added an optional atomic Redis-backed rate limiter using the already-supported `REDIS_URL`; when unset, the existing process-local fallback is used. When explicitly configured Redis is unavailable, requests are rate-limited fail-closed. This does **not** make the live deployment distributed until the approved production environment is configured to use shared Redis.
- SEC-004: Added `Content-Security-Policy-Report-Only` to observe policy compatibility without enforcing a blocking CSP.
- PROD-002: Removed secret-valued Docker build arguments. The builder now uses non-production placeholder values; real runtime credentials must be injected by the hosting platform at runtime.
- PROD-003: Added regression checks for upload expiry/rate-limit wiring. Existing tests cover 800 MiB upload limits and bounded byte-range behavior. Real 800 MiB staging tests remain unrun.

## Deliberately not changed

- PROD-001: `fly.toml` still contains `m.media-growplants.com`, while the current application default references `growplants-media.up.railway.app`. This mismatch is documented but not edited because the approved scope forbids production configuration changes. The live hosting platform and its active environment values have not been verified.
- PROD-004: Dependency audit needs a successful registry-backed `npm audit --omit=dev` run. No packages were upgraded as part of this remediation.
- No schema or data migrations; no media, channel, folder, file, sequence, or share mappings were changed.

## Required before production sign-off

1. Verify trusted-proxy behavior for `X-Forwarded-For`; the first forwarded address is trustworthy only if the edge strips client-supplied forwarding headers.
2. If multiple instances are used, provision/configure shared Redis only with explicit infrastructure approval and set `REDIS_URL` in the actual runtime environment.
3. Review CSP report-only violations in real browser flows before considering enforcement.
4. Confirm the authoritative production host and reconcile canonical URL settings only after separate approval.
5. Run staging tests with large files, cancellation, missing chunks, process restarts, disk pressure, and upload cleanup.
6. Complete a registry-backed dependency audit and assess direct/transitive advisories before upgrading anything.

## Dependency audit result (2026-10-10)

`npm audit --omit=dev --json` completed successfully against the configured registry and reported **11 production dependency advisories: 1 critical, 6 high, and 4 moderate**. This is a real release blocker.

Direct packages flagged include:

- `next`: critical advisory range includes `16.3.5`; the report lists multiple Next.js advisories and indicates a fix is available.
- `sharp`: high severity advisories; the reported fix is `0.35.5` and is marked semver-major.
- `@mdxeditor/editor`: moderate, with a suggested fix at `4.3.2` marked semver-major.
- `react-syntax-highlighter`: moderate, with a suggested fix at `16.1.2` marked semver-major.
- `prisma`: high severity through `@prisma/config` / `deepmerge-ts` transitive dependencies.

The full registry audit output should be re-run at the time dependency remediation is approved because advisory databases and package versions change. No dependency versions or lockfiles were changed. Since several suggested fixes are major-version upgrades and can alter editor, image-processing, or rendering behavior, package remediation requires a separate explicit approval after a compatibility plan is prepared.
