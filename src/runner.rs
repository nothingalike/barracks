use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

#[derive(Clone, Default)]
pub struct Control(Arc<AtomicBool>);

impl Control {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    fn cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct Outcome {
    pub text: String,
    pub success: bool,
    pub stopped: bool,
}

pub fn command(harness: &str, folder: &Path) -> Result<Command, String> {
    if !folder.is_dir() {
        return Err("Choose an existing project folder using Browse.".into());
    }
    // Only event-output flags are supplied. Model, permission and project settings belong to the CLI.
    let args: &[&str] = if harness == "Claude Code" {
        &["-p", "--verbose", "--output-format", "stream-json"]
    } else {
        &["exec", "--json", "-"]
    };
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd.exe");
        let invocation = format!(
            "{} {}",
            if harness == "Claude Code" {
                "claude"
            } else {
                "codex"
            },
            args.join(" ")
        );
        command.args(["/d", "/s", "/c", &invocation]);
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new(if harness == "Claude Code" {
            "claude"
        } else {
            "codex"
        });
        command.args(args);
        command
    };
    command
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

#[derive(Default)]
struct StreamResult {
    text: String,
    failed: bool,
}

// Both harnesses describe work as events; only assistant/result text becomes the final output.
impl StreamResult {
    fn consume(&mut self, line: &str) -> Vec<String> {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            self.text.push_str(line);
            self.text.push('\n');
            return vec![line.to_owned()];
        };
        let mut activity = Vec::new();
        match event["type"].as_str().unwrap_or("") {
            "thread.started" | "system" => activity.push("Harness initialized".into()),
            "turn.started" => activity.push("Working on the task".into()),
            "item.started" | "item.completed" => {
                let item = &event["item"];
                match item["type"].as_str().unwrap_or("") {
                    "agent_message" => {
                        if let Some(text) = item["text"].as_str() {
                            self.text = text.to_owned();
                        }
                        activity.push("Response received".into());
                    }
                    "command_execution" => activity.push(format!(
                        "{} {}",
                        if event["type"] == "item.started" {
                            "Running:"
                        } else {
                            "Finished:"
                        },
                        item["command"].as_str().unwrap_or("command")
                    )),
                    "file_change" => {
                        for change in item["changes"].as_array().into_iter().flatten() {
                            activity.push(format!(
                                "File change: {}",
                                change["path"].as_str().unwrap_or("project file")
                            ));
                        }
                    }
                    "mcp_tool_call" => {
                        activity.push(format!("Tool: {}", item["tool"].as_str().unwrap_or("MCP")))
                    }
                    _ => {}
                }
            }
            "assistant" => {
                let mut text = String::new();
                for block in event["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str().unwrap_or("") {
                        "text" => {
                            if let Some(part) = block["text"].as_str() {
                                text.push_str(part);
                                text.push('\n');
                            }
                        }
                        "tool_use" => activity.push(format!(
                            "Tool: {}",
                            block["name"].as_str().unwrap_or("tool")
                        )),
                        _ => {}
                    }
                }
                if !text.is_empty() {
                    self.text = text;
                    activity.push("Response received".into());
                }
            }
            "result" => {
                if let Some(text) = event["result"].as_str() {
                    self.text = text.to_owned();
                }
                self.failed = event["is_error"].as_bool().unwrap_or(false);
                if self.failed {
                    if let Some(errors) = event["errors"].as_array() {
                        self.text = errors
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("\n");
                    }
                    activity.push("Harness reported a failure".into());
                }
            }
            "turn.failed" | "error" => {
                self.failed = true;
                let message = event["message"]
                    .as_str()
                    .or_else(|| event["error"]["message"].as_str())
                    .unwrap_or("Harness reported a failure");
                self.text.push_str(message);
                activity.push(message.into());
            }
            "turn.completed" => activity.push("Task execution finished".into()),
            _ => {}
        }
        activity
            .into_iter()
            .map(|s| s.chars().take(500).collect())
            .collect()
    }
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn execute(
    mut command: Command,
    prompt: String,
    control: Control,
    activity: impl Fn(String) + Send + Sync + 'static,
) -> Result<Outcome, String> {
    if control.cancelled() {
        return Ok(Outcome {
            text: "Task stopped.".into(),
            success: false,
            stopped: true,
        });
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start the harness: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Harness input is unavailable.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Harness output is unavailable.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Harness diagnostics are unavailable.")?;
    let activity = Arc::new(activity);
    let output_activity = activity.clone();
    let output = thread::spawn(move || -> Result<StreamResult, String> {
        let mut result = StreamResult::default();
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| format!("Could not read harness output: {e}"))?;
            for message in result.consume(&line) {
                output_activity(message);
            }
        }
        Ok(result)
    });
    let errors = thread::spawn(move || -> Result<String, String> {
        let mut bytes = Vec::new();
        BufReader::new(stderr)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    });
    let input = thread::spawn(move || stdin.write_all(prompt.as_bytes()));
    let (status, stopped) = loop {
        if control.cancelled() {
            kill_tree(&mut child);
            break (None, true);
        }
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                kill_tree(&mut child);
                return Err(format!("Could not wait for the harness: {e}"));
            }
        }
    };
    let input_result = input.join().map_err(|_| "Input worker failed.")?;
    let output = output.join().map_err(|_| "Output worker failed.")??;
    let errors = errors.join().map_err(|_| "Diagnostics worker failed.")??;
    if stopped {
        return Ok(Outcome {
            text: "Task stopped. Changes already made remain in the project.".into(),
            success: false,
            stopped: true,
        });
    }
    let success = status.is_some_and(|s| s.success()) && !output.failed;
    let mut text = output.text.trim().to_owned();
    if !success {
        if !errors.trim().is_empty() {
            text.push_str("\n\n");
            text.push_str(errors.trim());
        }
        if let Some(status) = status {
            text.push_str(&format!("\n\nProcess exited with {status}."));
        }
    }
    input_result.map_err(|e| format!("Could not send instructions: {e}\n{text}"))?;
    if text.is_empty() {
        text = "The harness returned no final text.".into();
    }
    Ok(Outcome {
        text,
        success,
        stopped: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_commands_only_add_output_flags_and_keep_the_project_directory() {
        let folder = std::env::current_dir().unwrap();
        for (harness, invocation) in [
            ("Codex", "codex exec --json -"),
            (
                "Claude Code",
                "claude -p --verbose --output-format stream-json",
            ),
        ] {
            let command = command(harness, &folder).unwrap();
            assert_eq!(command.get_current_dir(), Some(folder.as_path()));
            #[cfg(windows)]
            assert_eq!(command.get_args().last().unwrap(), invocation);
            assert!(command.get_envs().next().is_none());
        }
        assert!(command("Codex", &folder.join("Cargo.toml")).is_err());
    }

    #[test]
    fn codex_events_separate_commands_from_the_final_response() {
        let mut result = StreamResult::default();
        assert!(result.consume(r#"{"type":"item.started","item":{"type":"command_execution","command":"cargo test"}}"#)[0].contains("cargo test"));
        result.consume(
            r##"{"type":"item.completed","item":{"type":"agent_message","text":"# Plan\nDone."}}"##,
        );
        assert_eq!(result.text, "# Plan\nDone.");
        assert!(!result.failed);
        result.consume(r#"{"type":"turn.failed","error":{"message":"denied"}}"#);
        assert!(result.failed);
    }

    #[test]
    fn claude_result_is_authoritative_and_retains_error_status() {
        let mut result = StreamResult::default();
        let activity = result.consume(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"},{"type":"text","text":"Working"}]}}"#);
        assert!(activity.iter().any(|s| s == "Tool: Read"));
        result.consume(r#"{"type":"result","result":"Finished","is_error":false}"#);
        assert_eq!(result.text, "Finished");
        result.consume(r#"{"type":"result","is_error":true,"errors":["permission denied"]}"#);
        assert!(result.failed);
        assert_eq!(result.text, "permission denied");
    }

    #[test]
    #[cfg(windows)]
    fn subprocess_streams_before_exit_and_can_be_stopped() {
        use std::sync::mpsc;
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "$text = [Console]::In.ReadToEnd(); [Console]::Out.WriteLine($text); [Console]::Out.Flush(); Start-Sleep -Seconds 30"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let control = Control::default();
        let worker_control = control.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            execute(
                command,
                "literal $() & | instructions".into(),
                worker_control,
                move |s| {
                    let _ = sender.send(s);
                },
            )
        });
        let message = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(message, "literal $() & | instructions");
        assert!(!worker.is_finished());
        control.cancel();
        let result = worker.join().unwrap().unwrap();
        assert!(result.stopped);
        assert!(!result.success);
    }

    #[test]
    #[cfg(windows)]
    fn process_failure_keeps_diagnostics() {
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::Error.Write('check failed'); exit 7",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let result = execute(command, String::new(), Control::default(), |_| {}).unwrap();
        assert!(!result.success);
        assert!(result.text.contains("check failed"));
    }

    #[test]
    #[ignore = "Calls installed model harnesses using the user's existing settings"]
    fn installed_harnesses_stream_and_return_real_responses() {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR"));
        for harness in ["Codex", "Claude Code"] {
            let activities = Arc::new(std::sync::Mutex::new(Vec::new()));
            let collected = activities.clone();
            let result = execute(
                command(harness, folder).unwrap(),
                "Reply with exactly BARRACKS_STREAM_OK. Use no tools and make no file changes."
                    .into(),
                Control::default(),
                move |line| collected.lock().unwrap().push(line),
            )
            .unwrap();
            assert!(result.success, "{harness}: {}", result.text);
            assert!(
                result.text.contains("BARRACKS_STREAM_OK"),
                "{harness}: {}",
                result.text
            );
            assert!(
                !activities.lock().unwrap().is_empty(),
                "{harness} produced no activity"
            );
            println!("{harness}: parsed real response and activity");
        }
    }
}
