# Development reference

Barracks uses Rust and Slint. Run Cargo commands from the repository root. The Cargo lockfile is committed.

## Build and check commands

| Command | Purpose |
| --- | --- |
| `cargo run --locked` | Build and launch the desktop app. |
| `cargo build --release --locked` | Build `target/release/barracks.exe` on Windows. |
| `cargo fmt --check` | Check Rust formatting. |
| `cargo test --locked` | Run the local test suite. Live AI tests are ignored by default. |
| `cargo clippy --locked --all-targets -- -D warnings` | Check all Rust targets with warnings treated as errors. |

After dependencies have been downloaded, `--offline` keeps Cargo from contacting the package registry. It does not disable network access inside an explicitly selected live AI test.

### Live AI checks

These opt-in tests invoke the installed tools using their existing accounts and settings. They need network access and use the account's normal model usage.

Both tools, with a text-only smoke prompt:

```powershell
cargo test --locked installed_harnesses_stream_and_return_real_responses -- --ignored --nocapture
```

Codex planning loop, with a disposable issue and an explicit storage answer:

```powershell
cargo test --locked installed_codex_plans_then_applies_explicit_answers -- --ignored --nocapture
```

The planning trial retains its issue and checkpoints under `.state/plan-live-<timestamp>/`. The full planning loop has been exercised with Codex. The Claude adapter has a separate smoke check.

The offscreen UI test writes screenshots under `target/ui-previews/`. It exercises pointer and keyboard input without opening desktop windows.

## Execution and configuration

Barracks invokes one of these commands from the selected project folder:

```text
codex exec --json -
claude -p --verbose --output-format stream-json
```

Instructions go through standard input. The added CLI flags select machine-readable output. Model selection, authentication, permissions, sandboxing, and project instructions remain controlled by the CLI configuration. Barracks writes no CLI configuration and hosts no interactive CLI approval prompt.

Each task and planning continuation starts a fresh execution. Planning supplies the saved checkpoint and explicit answers as context. It follows the bundled [planning procedure](../operations/plan-issue.md), and the app validates the returned checkpoint before applying it.

## Files and local storage

- Plans are written inside the selected project under `output/plans/plan-<target-hash>.md`.
- Windows task history lives under `%LOCALAPPDATA%\BarracksExample\outputs\`. The name is retained from the prototype to preserve existing history.
- History folders and operation-state files are keyed by the project's canonical folder path. Moving a project changes its storage identity.
- Saved task outputs include responses, artifact snapshots, activity, and captured comparisons. Opening a snapshot reads its saved text.
- Planning state includes pending answers and feedback. An operation saved while working reloads as **Interrupted** and waits for an explicit retry.

## Current limits

| Item | Limit or behavior |
| --- | --- |
| Text preview or individual attachment | UTF-8, up to 1 MiB. |
| Combined attached prompt context | 4 MiB. |
| File-change scan | Up to 10,000 files; partial scans are labeled. Build and cache folders and symlinks are skipped. |
| Explorer | Up to 3,000 rows. |
| Text snapshots for comparisons | Up to 8 MiB per snapshot. |
| Comparison display | Up to 400 removed and 400 added lines per file, in one replacement region between common beginning and ending lines. |
| Activity buffer | The latest 500 events. |
| Planning questions | Up to 10 per checkpoint. |
| Built-in commands | `/plan`. Unknown slash commands are rejected. |

File comparisons describe changes observed across the run interval. Concurrent edits can appear in them. Unreadable, binary, or uncaptured content is labeled as unavailable for comparison.

Code colors use a local lexical highlighter. Unrecognized languages remain plain text. Markdown rendering supports common text blocks and falls back to plain text for unsupported formatting.
