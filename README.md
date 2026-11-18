# Barracks

Run the app:

```powershell
cargo run
```

Choose a project folder with Browse. The app shows only its name (for example, `example`) and keeps the full path internally. The selected folder is the harness's working directory, so its project instructions and configuration apply.

Type `/` to open the built-in operation menu. Choose **Plan Work for Issue**, enter an issue file or reference in the target field, and click **Start planning**. You can also enter the target directly:

```text
/plan project/stories/EX-002.md
Keep the existing storage model.
```

The first line names the operation and target. Later lines provide additional direction. Plain instructions continue to run as general tasks.

Planning follows the bundled [procedure](operations/plan-issue.md), adapted from `002-plan-issue.md`. Each execution returns a structured checkpoint. The application saves the plan under `output/plans/` and presents questions, unselected suggestions, and references in **Questions**. Enter answers or feedback and click **Update plan**. Partial answers are allowed; unresolved questions remain for a later checkpoint. Unsupported or malformed checkpoints fail the step and preserve the previous plan and pending answers.

**No remaining questions** means the plan is ready for a new direction or **Finish operation**. It does not start implementation. **New task** pauses planning; **Resume planning** restores it. The current operation and draft answers reload after restart. An interrupted execution is marked **Interrupted** and needs an explicit retry. Each continuation uses a fresh harness execution with the saved plan, questions, answers, and feedback; there is no conversation transcript.

Use the gear button in the header to choose Codex or Claude Code. Enter instructions, then use Add files, drag text files from Explorer onto Instructions, or click the + beside a file. Attached files appear as removable chips. Click Run task to start a fresh execution with those instructions and attachments. Attachments are read again for every run.

While running, Activity shows timestamped harness events and elapsed time. The log follows the newest event, including when its 500-event buffer replaces old entries. You can scroll back; the next event returns to the bottom. Instruction edits apply to the next run. Stop cancels this worker's process tree on Windows; completed file changes remain. Closing the app also stops its active worker.

After completion, the task card shows the submitted instructions. Edit task opens them for revision; Run again repeats them. Preview renders the result with headings, lists, emphasis and code blocks. A changed text artifact opens automatically, preferring Markdown under `output/`, then other Markdown, then another readable text file. Task result returns to the original harness response. Copy copies the displayed text. On Windows, Open file tries installed VS Code executables first and falls back to Notepad if it cannot launch VS Code.

Code previews use lexical colors for keywords, strings, comments, numbers, and function names. Supported extensions include Rust, Slint, JavaScript/TypeScript, C/C++/C#, Python, JSON, TOML, YAML, SQL, shell scripts, and PowerShell. Markdown code fences use their language label. Unknown languages keep plain text. Highlighting preserves the original text for Copy and uses no external highlighting service.

Changes compares text captured before and after the run, with removed lines in red and added lines in green. Each file uses one replacement region between its common prefix and suffix. Binary files, unreadable files, and files outside the snapshot budget have an explicit comparison-unavailable message. Comparisons retain up to 8 MiB of text per snapshot and display up to 400 removed and 400 added lines per file. Activity remains available after completion.

The sidebar shows the project above two collapsible sections. Explorer expands folders and previews UTF-8 text files. It refreshes automatically every two seconds and when a task finishes. Green A and blue M markers identify files observed as created or updated during execution. The summary also counts removals. Other edits made during the same interval can appear in these observations.

Recent tasks keeps responses, text artifact snapshots, submitted instructions, attachment paths, activity, and comparisons for new runs. Select an entry to read it, including while another task runs. Task result shows that entry's original harness response. Live activity or Latest task returns to the current task. History is stored in the app's local data directory, separately for each project, and reloads across restarts. Reading an old snapshot does not read the current version of its generated file. Earlier history records still load; metadata that was never captured remains empty.

The app invokes `codex exec --json -` or `claude -p --verbose --output-format stream-json` from PATH. The output flags enable machine-readable activity; model selection, authentication, permissions, sandboxing, project instructions and other CLI settings remain configured by the user. The app writes no CLI configuration, passes instructions through stdin and uses no resume/continue option. CLI-managed session records may still be saved normally. Each CLI must already be installed and authenticated; interactive permission prompts are not hosted by Barracks.

Text previews and individual attachments support up to 1 MiB; combined prompt context supports 4 MiB. File scans skip build/cache folders and symlinks, tracking up to 10,000 files; a partial scan is labeled. The explorer displays up to 3,000 rows. Markdown rendering supports common text blocks, with a plain-text fallback for unsupported formatting.

Checks:

```powershell
cargo test --offline
cargo clippy --offline --all-targets -- -D warnings
```

The UI test renders running, completed, greeting preview, changes, compact, collapsed-sidebar, options and file-drag previews into `target/ui-previews/` without opening desktop windows. It dispatches tab, drag, drop and attach-button events to the offscreen window. To explicitly call both installed harnesses with a text-only smoke prompt:

```powershell
cargo test --offline installed_harnesses_stream_and_return_real_responses -- --ignored --nocapture
```

To run the real Codex planning-and-answer trial on a disposable issue (uses the installed CLI and network):

```powershell
cargo test --offline installed_codex_plans_then_applies_explicit_answers -- --ignored --nocapture
```
