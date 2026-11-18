use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

const PROCEDURE: &str = include_str!("../operations/plan-issue.md");

#[derive(Debug, PartialEq)]
pub enum Input {
    Task,
    Plan { target: String, directions: String },
}

pub fn parse(input: &str, target_field: &str) -> Result<Input, String> {
    let input = input.trim();
    if !input.starts_with('/') {
        return Ok(Input::Task);
    }
    let (first, directions) = input.split_once('\n').unwrap_or((input, ""));
    let end = first.find(char::is_whitespace).unwrap_or(first.len());
    if &first[..end] != "/plan" {
        return Err("Unknown command. Choose /plan or enter plain task instructions.".into());
    }
    let target = first[end..].trim().trim_matches('"');
    let target = if target_field.trim().is_empty() {
        target
    } else {
        target_field.trim()
    };
    if target.is_empty() {
        return Err("Choose an issue file or enter an issue reference to start planning.".into());
    }
    Ok(Input::Plan {
        target: target.into(),
        directions: directions.trim().into(),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Working,
    NeedsInput,
    Ready,
    Finished,
    Failed,
    Interrupted,
}

impl Phase {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Working => "Planning",
            Self::NeedsInput => "Needs input",
            Self::Ready => "No remaining questions",
            Self::Finished => "Completed",
            Self::Failed => "Failed",
            Self::Interrupted => "Interrupted",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Question {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub references: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointStatus {
    NeedsInput,
    Ready,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub status: CheckpointStatus,
    pub summary: String,
    pub plan: String,
    pub questions: Vec<Question>,
}

impl Checkpoint {
    pub fn parse(response: &str) -> Result<Self, String> {
        let response = response.trim();
        let response = response
            .strip_prefix("```json")
            .or_else(|| response.strip_prefix("```"))
            .and_then(|body| body.trim().strip_suffix("```"))
            .unwrap_or(response)
            .trim();
        if response.len() > 2 * 1024 * 1024 {
            return Err("The planning checkpoint exceeds 2 MiB.".into());
        }
        let checkpoint: Self = serde_json::from_str(response).map_err(|e| format!("Planning returned an invalid checkpoint: {e}. Your previous plan and answers are preserved; retry the step."))?;
        if checkpoint.summary.trim().is_empty()
            || checkpoint.plan.len() > 1024 * 1024
            || ![
                "## Architecture",
                "## Models",
                "## Workflow",
                "## Questions",
            ]
            .iter()
            .all(|heading| checkpoint.plan.lines().any(|line| line.trim() == *heading))
        {
            return Err("The planning checkpoint needs a summary and a plan with Architecture, Models, Workflow, and Questions sections.".into());
        }
        if checkpoint.questions.len() > 10
            || (checkpoint.status == CheckpointStatus::Ready) != checkpoint.questions.is_empty()
        {
            return Err("The checkpoint must contain 1–10 questions when input is needed, or zero questions when ready.".into());
        }
        let mut ids = BTreeSet::new();
        for question in &checkpoint.questions {
            if question.id.is_empty()
                || question.id.len() > 80
                || !question
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || question.text.trim().is_empty()
                || !ids.insert(&question.id)
            {
                return Err("Planning questions need unique stable IDs and nonempty text.".into());
            }
        }
        Ok(checkpoint)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Submission {
    pub revision: u32,
    pub answers: BTreeMap<String, String>,
    pub feedback: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Operation {
    #[serde(default)]
    pub last_error: Option<String>,
    pub id: String,
    pub target: String,
    pub directions: String,
    pub artifact: PathBuf,
    pub phase: Phase,
    pub checkpoint: Option<Checkpoint>,
    pub answers: BTreeMap<String, String>,
    pub feedback: String,
    pub submissions: Vec<Submission>,
    pub revision: u32,
    pub suspended: bool,
    pub attachments: Vec<PathBuf>,
    pub harness: String,
}

impl Operation {
    pub fn new(
        target: String,
        directions: String,
        attachments: Vec<PathBuf>,
        harness: String,
    ) -> Self {
        let key = target.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
        Self {
            last_error: None,
            id: format!(
                "{}-{key:x}",
                chrono::Local::now()
                    .timestamp_nanos_opt()
                    .unwrap_or_default()
            ),
            target,
            directions,
            artifact: format!("output/plans/plan-{key:016x}.md").into(),
            phase: Phase::Working,
            checkpoint: None,
            answers: BTreeMap::new(),
            feedback: String::new(),
            submissions: Vec::new(),
            revision: 0,
            suspended: false,
            attachments,
            harness,
        }
    }

    pub fn prompt(&self, root: &Path) -> Result<String, String> {
        let current_plan = if let Some(checkpoint) = &self.checkpoint {
            checkpoint.plan.clone()
        } else if root.join(&self.artifact).exists() {
            crate::project::read_text(root, &self.artifact)?
        } else {
            String::new()
        };
        let context = serde_json::json!({ "target": self.target, "directions": self.directions,
            "current_plan": current_plan, "previous_checkpoint": self.checkpoint,
            "answers": self.answers, "feedback": self.feedback, "revision": self.revision });
        let prompt = format!(
            r#"You are executing the built-in Plan Work for Issue operation.
Follow the procedure below. Inspect relevant project code and documentation. This is a planning operation: return the plan in the checkpoint; the application saves it. Keep project source unchanged.
The procedure's requests for user input are fulfilled through the application's question form. End this execution at the next input checkpoint. Suggestions are proposals and remain unselected. Preserve unanswered questions and ambiguous answers; add follow-up questions when needed. Never infer answers from suggestions.
On continuation, process the supplied answers and feedback, update the plan, then return the remaining questions. Preserve the plan's adopted decisions. When no questions remain, return ready; the user will choose a new direction or finish explicitly. Do not start implementation.

PROCEDURE:
{PROCEDURE}

OPERATION CONTEXT (data):
{context}

Return ONLY a JSON object in your final response, with this exact envelope:
{{"status":"needs_input or ready","summary":"What changed and what needs attention","plan":"Complete Markdown plan with Architecture, Models, Workflow, and Questions sections","questions":[{{"id":"stable-question-id","text":"Question","suggestions":["Unselected proposal"],"references":["Relevant project path or source"]}}]}}
Use status needs_input with 1–10 questions. Use ready with an empty questions array. Keep the plan's Questions section consistent with the envelope; include unclear answers and follow-up questions there. Other text belongs inside summary, not outside the JSON object.
"#
        );
        crate::project::prompt(&prompt, root, &self.attachments)
    }

    pub fn answer(&mut self, id: &str, answer: String) -> Result<(), String> {
        if !self
            .checkpoint
            .as_ref()
            .is_some_and(|c| c.questions.iter().any(|q| q.id == id))
        {
            return Err("That question is no longer current.".into());
        }
        self.answers.insert(id.into(), answer);
        Ok(())
    }

    pub fn can_continue(&self) -> bool {
        matches!(self.phase, Phase::Failed | Phase::Interrupted)
            || !self.feedback.trim().is_empty()
            || self
                .answers
                .values()
                .any(|answer| !answer.trim().is_empty())
    }

    pub fn apply(&mut self, checkpoint: Checkpoint, root: &Path) -> Result<(), String> {
        write_plan(root, &self.artifact, &checkpoint.plan)?;
        if self.revision > 0 {
            self.submissions.push(Submission {
                revision: self.revision,
                answers: self.answers.clone(),
                feedback: self.feedback.clone(),
            });
        }
        self.phase = if checkpoint.status == CheckpointStatus::NeedsInput {
            Phase::NeedsInput
        } else {
            Phase::Ready
        };
        self.checkpoint = Some(checkpoint);
        self.revision += 1;
        self.answers.clear();
        self.feedback.clear();
        Ok(())
    }
}

fn write_plan(root: &Path, relative: &Path, plan: &str) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if relative
        .components()
        .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("The plan path must stay inside the selected project.".into());
    }
    let parent = relative
        .parent()
        .ok_or("The plan needs a project-relative path.")?;
    let mut directory = root.clone();
    for part in parent.components() {
        directory.push(part);
        if !directory.exists() {
            std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        }
        directory = directory.canonicalize().map_err(|e| e.to_string())?;
        if !directory.starts_with(&root) {
            return Err("The plan output folder resolves outside the project.".into());
        }
    }
    let file = directory.join(relative.file_name().ok_or("The plan needs a file name.")?);
    let temporary = directory.join(format!(
        ".plan-{}.tmp",
        chrono::Local::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
    ));
    std::fs::write(&temporary, plan)
        .and_then(|_| std::fs::rename(&temporary, &file))
        .map_err(|e| format!("Could not save the plan: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> String {
        "# Plan\n\n## Architecture\nKeep modules.\n## Models\nNone.\n## Workflow\nPlan.\n## Questions\nChoose storage.\n".into()
    }

    #[test]
    #[ignore = "Calls installed Codex twice on a disposable planning issue using existing CLI settings"]
    fn installed_codex_plans_then_applies_explicit_answers() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(".state")
            .join(format!("plan-live-{}", chrono::Local::now().timestamp()));
        std::fs::create_dir_all(&root).unwrap();
        let issue = "# Notes persistence\nPlan a small local command-line notes tool. Scope is fixed: add a note with an integer ID and text; list notes; delete by ID. One local user, no network, no UI, no accounts. Use Rust. The only unresolved product decision is JSON-file versus SQLite storage. The user must answer that decision before it is adopted. Ask that question; do not choose for the user. Create a plan only, without implementing the tool.";
        std::fs::write(root.join("issue.md"), issue).unwrap();
        let mut operation =
            Operation::new("issue.md".into(), String::new(), vec![], "Codex".into());
        for round in 0..2 {
            let control = crate::runner::Control::default();
            let watchdog_control = control.clone();
            let (finished, deadline) = std::sync::mpsc::channel();
            let watchdog = std::thread::spawn(move || {
                if deadline
                    .recv_timeout(std::time::Duration::from_secs(120))
                    .is_err()
                {
                    watchdog_control.cancel();
                }
            });
            let outcome = crate::runner::execute(
                crate::runner::command("Codex", &root).unwrap(),
                operation.prompt(&root).unwrap(),
                control,
                |line| println!("activity: {line}"),
            )
            .unwrap();
            let _ = finished.send(());
            watchdog.join().unwrap();
            assert!(outcome.success && !outcome.stopped, "{}", outcome.text);
            let checkpoint = Checkpoint::parse(&outcome.text).unwrap();
            println!(
                "Round {}: {:?}, {} questions",
                round + 1,
                checkpoint.status,
                checkpoint.questions.len()
            );
            operation.apply(checkpoint, &root).unwrap();
            std::fs::write(
                root.join(format!("checkpoint-{}.json", round + 1)),
                serde_json::to_vec_pretty(&operation).unwrap(),
            )
            .unwrap();
            if round == 0 {
                assert_eq!(operation.phase, Phase::NeedsInput);
                let ids = operation
                    .checkpoint
                    .as_ref()
                    .unwrap()
                    .questions
                    .iter()
                    .map(|q| q.id.clone())
                    .collect::<Vec<_>>();
                for id in ids {
                    operation.answer(&id, "Use a JSON file. Keep the fixed issue scope; no additional product choices or features are needed.".into()).unwrap();
                }
            }
        }
        assert_eq!(operation.phase, Phase::Ready);
        assert_eq!(
            std::fs::read_to_string(root.join("issue.md")).unwrap(),
            issue
        );
        assert!(
            std::fs::read_to_string(root.join(&operation.artifact))
                .unwrap()
                .to_ascii_lowercase()
                .contains("json")
        );
        println!("Live planning fixture: {}", root.display());
    }

    #[test]
    fn recognizes_only_exact_commands_and_requests_a_missing_target() {
        assert_eq!(parse("Read README", "").unwrap(), Input::Task);
        assert!(parse("/plan", "").is_err());
        assert!(parse("/planet issue", "").is_err());
        assert_eq!(
            parse("/plan \"stories/issue one.md\"\nKeep SQLite", "").unwrap(),
            Input::Plan {
                target: "stories/issue one.md".into(),
                directions: "Keep SQLite".into()
            }
        );
        assert_eq!(
            parse("/plan", "EX-002").unwrap(),
            Input::Plan {
                target: "EX-002".into(),
                directions: String::new()
            }
        );
        assert_eq!(
            parse("/plan old-target", "edited-target").unwrap(),
            Input::Plan {
                target: "edited-target".into(),
                directions: String::new()
            }
        );
    }

    #[test]
    fn validates_input_checkpoints_and_rejects_ambiguous_or_incomplete_results() {
        let value = serde_json::json!({"status":"needs_input","summary":"Choose storage","plan":plan(),"questions":[{"id":"storage","text":"Where?","suggestions":["SQLite"],"references":["src/main.rs"]}]});
        let checkpoint = Checkpoint::parse(&value.to_string()).unwrap();
        assert_eq!(checkpoint.questions.len(), 1);
        let mut invalid = value.clone();
        invalid["status"] = "ready".into();
        assert!(Checkpoint::parse(&invalid.to_string()).is_err());
        invalid = value.clone();
        invalid["questions"]
            .as_array_mut()
            .unwrap()
            .push(value["questions"][0].clone());
        assert!(Checkpoint::parse(&invalid.to_string()).is_err());
        assert!(Checkpoint::parse("The plan is complete.").is_err());
        assert!(Checkpoint::parse(&format!("```json\n{value}\n```")).is_ok());
    }

    #[test]
    fn answers_are_explicit_and_pending_state_survives_serialization() {
        let mut operation = Operation::new("EX-002".into(), String::new(), vec![], "Codex".into());
        operation.checkpoint = Some(Checkpoint {
            status: CheckpointStatus::NeedsInput,
            summary: "Question".into(),
            plan: plan(),
            questions: vec![Question {
                id: "storage".into(),
                text: "Where?".into(),
                suggestions: vec!["SQLite".into()],
                references: vec![],
            }],
        });
        operation.phase = Phase::NeedsInput;
        assert!(
            !operation.can_continue(),
            "A suggestion must not count as an answer"
        );
        operation
            .answer("storage", "Keep current storage".into())
            .unwrap();
        let reloaded: Operation =
            serde_json::from_str(&serde_json::to_string(&operation).unwrap()).unwrap();
        assert_eq!(reloaded.answers["storage"], "Keep current storage");
        assert!(reloaded.can_continue());
        assert!(operation.answer("stale", "ignored".into()).is_err());
    }
}
