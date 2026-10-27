# Barracks starter configuration

The user selected the official Factory starter on October 22, 2026. Keep the built-in Work/Review boards, runtime, persistence and UI as the base. Put project behavior in supported configuration and persona skills before considering framework changes.

The ten local skills under `src/mastra/public/factory-skills/` are the worker instructions. Factory's local skill source selects matching local lifecycle names ahead of its bundled versions. `npm run verify` exercises that selection using the installed Factory implementation, including the review binding needed to expose review skills.

The user selected local-only access without Mastra Platform sign-in. The ignored local overlay sets `BARRACKS_LOCAL_ACCESS=1`; the server binds to loopback. A development-only SimpleAuth adapter supplies a local operator identity because the bundled browser UI refuses `auth: null`. It accepts localhost/127.0.0.1 on port 4111 and refuses foreign origins and cross-site browser requests. Credential encryption remains configured independently of sign-in. Model/provider selection and repository connections happen in the UI. Start with a disposable repository and confirm that real sessions load the instructions before enabling production intake. The existing Saltwake coordinator and worktrees remain in place.

The two-task in-flight limit is a per-process background-dispatch budget. Persona instructions express the fixed Lead/BA/two-Builder team; they do not prove runtime slot allocation. Verify role assignment and peer-review identity on actual sessions.

Changes to upstream configuration cover provenance version, a local database URL override, loopback binding and credential encryption independent of sign-in. Keep provider authentication, Factory storage and standard onboarding in the upstream code. The ignored local overlay selects development storage/sandbox paths; local sandbox execution runs as the server user and needs separate isolation qualification before protected canonical access.

The previous custom runtime stays outside this application's imports. Its tickets and evidence are history, not an alternate production backend.
