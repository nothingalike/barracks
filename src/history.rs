use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Output {
    pub id: String,
    pub title: String,
    pub when: String,
    pub harness: String,
    pub status: String,
    pub elapsed: String,
    pub response: String,
    pub artifact: Option<PathBuf>,
    pub artifact_text: Option<String>,
    pub summary: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub attachments: Vec<PathBuf>,
    #[serde(default)]
    pub activity: String,
    #[serde(default)]
    pub changed_count: i32,
    #[serde(default)]
    pub diff: Vec<(String, i32)>,
    #[serde(default)]
    pub operation: Option<crate::operation::Operation>,
}

pub struct Store {
    folder: PathBuf,
}

impl Store {
    fn operation_path(&self) -> PathBuf {
        self.folder.with_extension("operation.json")
    }

    pub fn save_operation(&self, operation: &crate::operation::Operation) -> Result<(), String> {
        let file = self.operation_path();
        fs::create_dir_all(file.parent().ok_or("Operation storage is unavailable.")?)
            .map_err(|e| e.to_string())?;
        let temporary = file.with_extension(format!("{}.tmp", std::process::id()));
        let bytes = serde_json::to_vec(operation).map_err(|e| e.to_string())?;
        fs::write(&temporary, bytes)
            .and_then(|_| fs::rename(&temporary, &file))
            .map_err(|e| format!("Could not save planning state: {e}"))
    }

    pub fn load_operation(&self) -> Result<Option<crate::operation::Operation>, String> {
        let file = self.operation_path();
        let bytes = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let mut operation: crate::operation::Operation = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Could not read the saved planning operation: {e}"))?;
        if operation.phase == crate::operation::Phase::Working {
            operation.phase = crate::operation::Phase::Interrupted;
        }
        Ok(Some(operation))
    }
    pub fn for_project(root: &Path) -> Result<Self, String> {
        #[cfg(windows)]
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        #[cfg(not(windows))]
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            });
        let base = base.ok_or("Saved-output storage is unavailable.")?;
        Self::at(&base.join("BarracksExample/outputs"), root)
    }

    fn at(base: &Path, root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|_| "The project folder is unavailable.".to_owned())?;
        let identity = root.to_string_lossy().replace('\\', "/");
        #[cfg(windows)]
        let identity = identity.to_lowercase();
        // Stable FNV-1a names keep the project path out of filenames and the UI.
        let key = identity.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
        Ok(Self {
            folder: base.join(format!("{key:016x}")),
        })
    }

    pub fn load(&self) -> Result<(Vec<Output>, usize), String> {
        let entries = match fs::read_dir(&self.folder) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), 0));
            }
            Err(_) => return Err("Could not read saved outputs for this project.".into()),
        };
        let mut outputs = Vec::new();
        let mut unreadable = 0;
        for entry in entries {
            let record = entry
                .ok()
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .and_then(|entry| fs::read(entry.path()).ok())
                .and_then(|bytes| serde_json::from_slice::<Output>(&bytes).ok());
            if let Some(record) = record {
                outputs.push(record);
            } else {
                unreadable += 1;
            }
        }
        outputs.sort_by(|a, b| b.id.cmp(&a.id));
        Ok((outputs, unreadable))
    }

    pub fn save(&self, mut output: Output) -> Result<Output, String> {
        fs::create_dir_all(&self.folder)
            .map_err(|_| "Could not create saved-output storage.".to_owned())?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Could not timestamp this output.".to_owned())?
            .as_nanos();
        for suffix in 0..100 {
            output.id = format!("{timestamp:030}-{suffix:02}");
            let path = self.folder.join(format!("{}.json", output.id));
            let mut file = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(
                        "Could not save this output. It is still available in the task pane."
                            .into(),
                    );
                }
            };
            let bytes = serde_json::to_vec(&output)
                .map_err(|_| "Could not encode this output.".to_owned())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not finish saving this output.".to_owned())?;
            return Ok(output);
        }
        Err("Could not allocate a saved-output record.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planning_updates_survive_restart_and_require_explicit_finish() {
        use crate::operation::{Checkpoint, Operation, Phase};
        let base = std::env::temp_dir().join(format!(
            "barracks-operation-{}",
            chrono::Local::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(base.join("project")).unwrap();
        let project = base.join("project");
        fs::write(project.join("issue.md"), "Choose storage.").unwrap();
        let store = Store::at(&base.join("saved"), &project).unwrap();
        let mut operation = Operation::new(
            "issue.md".into(),
            "Preserve current scope".into(),
            vec![],
            "Codex".into(),
        );
        let document = "# Plan\n## Architecture\nExisting modules.\n## Models\nPending.\n## Workflow\nAsk storage.\n## Questions\nWhere to store data?";
        let checkpoint = serde_json::json!({"status":"needs_input","summary":"Storage needs a decision.","plan":document,"questions":[{"id":"storage","text":"Where should data live?","suggestions":["JSON","SQLite"],"references":["issue.md"]}]});
        operation
            .apply(
                Checkpoint::parse(&checkpoint.to_string()).unwrap(),
                &project,
            )
            .unwrap();
        assert_eq!(operation.phase, Phase::NeedsInput);
        assert!(!operation.can_continue());
        operation.answer("storage", "JSON file".into()).unwrap();
        store.save_operation(&operation).unwrap();
        let mut reloaded = store.load_operation().unwrap().unwrap();
        assert_eq!(reloaded.answers["storage"], "JSON file");
        assert!(reloaded.prompt(&project).unwrap().contains("JSON file"));
        assert_eq!(
            fs::read_to_string(project.join(&reloaded.artifact)).unwrap(),
            document
        );
        reloaded.phase = Phase::Working;
        store.save_operation(&reloaded).unwrap();
        assert_eq!(
            store.load_operation().unwrap().unwrap().phase,
            Phase::Interrupted
        );
        let ready = serde_json::json!({"status":"ready","summary":"JSON adopted.","plan":document.replace("Pending.", "JSON file.").replace("Where to store data?", "_no remaining questions_"),"questions":[]});
        reloaded
            .apply(Checkpoint::parse(&ready.to_string()).unwrap(), &project)
            .unwrap();
        assert_eq!(
            reloaded.phase,
            Phase::Ready,
            "A finished execution must not finish the operation"
        );
        assert_eq!(reloaded.submissions[0].answers["storage"], "JSON file");
        assert!(reloaded.answers.is_empty());
        assert!(
            fs::read_to_string(project.join(&reloaded.artifact))
                .unwrap()
                .contains("JSON file.")
        );
        store.save_operation(&reloaded).unwrap();
        assert_eq!(
            store.load().unwrap().1,
            0,
            "Planning state must not be counted as a corrupt history output"
        );
        reloaded.phase = Phase::Finished;
        store.save_operation(&reloaded).unwrap();
        assert_eq!(
            store.load_operation().unwrap().unwrap().phase,
            Phase::Finished
        );
        reloaded.artifact = "../outside.md".into();
        assert!(
            reloaded
                .apply(Checkpoint::parse(&ready.to_string()).unwrap(), &project)
                .is_err()
        );
        assert!(!base.join("outside.md").exists());
        assert_eq!(base.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            base.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("barracks-operation-")
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn older_outputs_load_without_new_task_metadata() {
        let json = r##"{"id":"old","title":"Earlier task","when":"Nov 17","harness":"Codex","status":"Completed","elapsed":"00:02","response":"done","artifact":null,"artifact_text":null,"summary":"0 changed"}"##;
        let output: Output = serde_json::from_str(json).unwrap();
        assert!(output.instructions.is_empty());
        assert!(output.attachments.is_empty());
        assert!(output.activity.is_empty());
        assert!(output.diff.is_empty());
        assert_eq!(output.changed_count, 0);
    }

    #[test]
    fn saves_immutable_outputs_and_reloads_them_per_project() {
        let base = std::env::temp_dir().join(format!(
            "barracks history {}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = base.join("first");
        let second = base.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let store = Store::at(&base.join("saved"), &first).unwrap();
        let output = Output {
            id: String::new(),
            title: "Plan project".into(),
            when: "Nov 18 · 09:00".into(),
            harness: "Codex".into(),
            status: "Completed".into(),
            elapsed: "00:24".into(),
            response: "Saved the plan".into(),
            artifact: Some("output/plan.md".into()),
            artifact_text: Some("# Original plan".into()),
            summary: "1 created".into(),
            instructions: "Write a plan".into(),
            attachments: vec!["README.md".into()],
            activity: "[00:01] Read README.md".into(),
            changed_count: 1,
            diff: vec![("+ 1 Original plan".into(), 5)],
            operation: None,
        };
        let saved = store.save(output.clone()).unwrap();
        let mut later = output;
        later.artifact_text = Some("# Revised plan".into());
        let revised = store.save(later).unwrap();
        let (loaded, errors) = Store::at(&base.join("saved"), &first)
            .unwrap()
            .load()
            .unwrap();
        assert_eq!(errors, 0);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, revised.id);
        assert_eq!(loaded[1].artifact_text.as_deref(), Some("# Original plan"));
        assert_eq!(loaded[1].instructions, "Write a plan");
        assert_eq!(loaded[1].attachments, [PathBuf::from("README.md")]);
        assert_eq!(loaded[1].activity, "[00:01] Read README.md");
        assert_eq!(loaded[1].changed_count, 1);
        assert_eq!(loaded[1].diff, [("+ 1 Original plan".into(), 5)]);
        assert!(
            Store::at(&base.join("saved"), &second)
                .unwrap()
                .load()
                .unwrap()
                .0
                .is_empty()
        );
        for record in [saved, revised] {
            fs::remove_file(store.folder.join(format!("{}.json", record.id))).unwrap();
        }
        fs::remove_dir(&store.folder).unwrap();
        fs::remove_dir(base.join("saved")).unwrap();
        fs::remove_dir(first).unwrap();
        fs::remove_dir(second).unwrap();
        fs::remove_dir(base).unwrap();
    }
}
