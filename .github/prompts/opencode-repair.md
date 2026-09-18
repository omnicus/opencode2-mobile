Repair this mobile app's compatibility with the OpenCode release specified by
OPENCODE_TEST_VERSION. The dependency-upgrade PR failed validation.

Read docs/SPEC.md and docs/COMPATIBILITY.md. Reproduce the failure with pnpm check
and the opt-in adapter integration suite. OPENCODE_TEST_BINARY points to an
isolated target CLI. Run the integration suite with:

pnpm --filter @opencode2-mobile/opencode-adapter test:integration

Make the smallest source fix and add regression coverage for the actual failure.
Keep support for the previous server release. Use the V2 docs and the installed
generated client types. Only packages/opencode-adapter may import
@opencode/client. Never import @opencode/client/service. Preserve direct
mobile-to-server transport, exact-location scoping, draft admission recovery,
SecureStore credentials, and bounded response handling.

You may edit only apps/mobile/src, packages/opencode-adapter/src,
packages/opencode-adapter/integration, and packages/test-fixtures/src.
Do not modify workflow files, scripts,
dependencies, native configuration, or the test provider's deterministic model
behavior. Do not weaken or skip tests, validations, or publication gates to make
checks pass. Do not commit, push, merge, publish, or change remote settings.
Do not read or print credentials, environment dumps, or account configuration.

Run pnpm check and pnpm native:doctor after the repair. Report remaining failures
honestly. The release workflow will independently test the branch before any
merge or publication.
