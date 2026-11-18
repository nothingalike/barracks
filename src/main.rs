mod history;
mod operation;
mod presentation;
mod project;
mod runner;
mod syntax;
#[cfg(test)]
mod ui_tests;

use project::{Change, Explorer, Snapshot};
use slint::{ComponentHandle, ModelRc, VecModel};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    rc::Rc,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

slint::include_modules!();

struct Workspace {
    root: PathBuf,
    explorer: Explorer,
    attachments: Vec<PathBuf>,
    changes: BTreeMap<PathBuf, Change>,
    selected: Option<PathBuf>,
    artifact: Option<PathBuf>,
    result: String,
    showing: String,
    activity: VecDeque<String>,
    started: Option<Instant>,
    control: runner::Control,
    worker: Option<thread::JoinHandle<()>>,
    outputs: Vec<history::Output>,
    viewing_output: Option<history::Output>,
    rendered_rows: Vec<FileRow>,
    current_title: String,
    current_harness: String,
    last_refresh: Instant,
    current_summary: String,
    current_instructions: String,
    operation: Option<operation::Operation>,
}

impl Workspace {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            explorer: Explorer::default(),
            attachments: Vec::new(),
            changes: BTreeMap::new(),
            selected: None,
            artifact: None,
            result: String::new(),
            showing: String::new(),
            activity: VecDeque::new(),
            started: None,
            control: runner::Control::default(),
            worker: None,
            outputs: Vec::new(),
            viewing_output: None,
            rendered_rows: Vec::new(),
            current_title: String::new(),
            current_harness: String::new(),
            last_refresh: Instant::now(),
            current_summary: String::new(),
            current_instructions: String::new(),
            operation: None,
        }
    }
}

enum Event {
    Activity(String),
    Done(Result<runner::Outcome, String>, Snapshot, Snapshot),
}

fn refresh(app: &AppWindow, state: &mut Workspace) {
    state.explorer.refresh(&state.root);
    let rows: Vec<_> = state
        .explorer
        .rows
        .iter()
        .map(|row| FileRow {
            name: row.name.clone().into(),
            depth: row.depth as i32,
            directory: row.directory,
            expanded: row.expanded,
            change: match state.changes.get(&row.relative) {
                Some(Change::Created) => 1,
                Some(Change::Updated) => 2,
                _ => 0,
            },
            selected: state.selected.as_ref() == Some(&row.relative),
        })
        .collect();
    if rows != state.rendered_rows {
        state.rendered_rows = rows.clone();
        app.set_files(ModelRc::new(VecModel::from(rows)));
    }
    state.last_refresh = Instant::now();
}

fn output_rows(app: &AppWindow, state: &Workspace) {
    app.set_saved_outputs(ModelRc::new(VecModel::from(
        state
            .outputs
            .iter()
            .map(|output| OutputRow {
                title: output.title.clone().into(),
                detail: format!("{} · {}", output.when, output.status).into(),
                selected: state
                    .viewing_output
                    .as_ref()
                    .map(|selected| selected.id == output.id)
                    .unwrap_or_else(|| {
                        !state.result.is_empty()
                            && state
                                .outputs
                                .first()
                                .is_some_and(|latest| latest.id == output.id)
                    }),
            })
            .collect::<Vec<_>>(),
    )));
}

fn load_outputs(app: &AppWindow, state: &mut Workspace) {
    match history::Store::for_project(&state.root).and_then(|store| store.load()) {
        Ok((outputs, unreadable)) => {
            state.outputs = outputs;
            if unreadable > 0 {
                app.set_notice("Some saved outputs could not be read.".into());
            }
        }
        Err(error) => {
            state.outputs.clear();
            app.set_notice(error.into());
        }
    }
    output_rows(app, state);
}

fn attachments(app: &AppWindow, state: &Workspace) {
    app.set_attachments(ModelRc::new(VecModel::from(
        state
            .attachments
            .iter()
            .map(|path| project::relative_name(path).into())
            .collect::<Vec<_>>(),
    )));
}

fn attach_file(app: &AppWindow, state: &mut Workspace, index: i32) {
    if app.get_running() {
        return;
    }
    let Some(row) = state.explorer.rows.get(index as usize) else {
        return;
    };
    if row.directory {
        return;
    }
    let result =
        project::relative_file(&state.root, &state.root.join(&row.relative)).and_then(|relative| {
            project::read_text(&state.root, &relative)?;
            Ok(relative)
        });
    match result {
        Ok(relative) => {
            let label = project::relative_name(&relative);
            if state.attachments.contains(&relative) {
                app.set_notice(format!("Already attached: {label}").into());
            } else {
                state.attachments.push(relative);
                app.set_notice(format!("Attached {label}").into());
            }
            attachments(app, state);
        }
        Err(error) => app.set_notice(error.into()),
    }
}

fn set_activity(app: &AppWindow, text: slint::SharedString) {
    app.set_activity_rows(ModelRc::new(VecModel::from(
        text.lines()
            .map(slint::SharedString::from)
            .collect::<Vec<_>>(),
    )));
    app.set_activity(text);
}

fn show_latest(app: &AppWindow, state: &mut Workspace) {
    if !app.get_running()
        && state
            .operation
            .as_ref()
            .is_some_and(|op| !op.suspended && op.phase != operation::Phase::Finished)
    {
        display_operation(app, state);
        output_rows(app, state);
        return;
    }
    state.viewing_output = None;
    app.set_browsing_history(false);
    app.set_previewing(false);
    if app.get_running() {
        state.selected = None;
        app.set_active_tab(2);
        app.set_editing_task(true);
        app.set_has_result(false);
        app.set_can_open(false);
        app.set_artifact("".into());
        app.set_change_summary("".into());
        app.set_task_title(state.current_title.clone().into());
        app.set_task_instructions(state.current_instructions.clone().into());
        app.set_task_attachments(app.get_attachments());
        app.set_changed_count(0);
        app.set_diff_blocks(ModelRc::default());
        set_activity(
            app,
            state
                .activity
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
                .into(),
        );
    } else if !state.result.is_empty() {
        if let Some(output) = state.outputs.first().cloned() {
            show_saved_output(app, state, output);
            state.viewing_output = None;
            app.set_browsing_history(false);
        }
        show_result(app, state);
    } else {
        app.set_editing_task(true);
        app.set_active_tab(0);
        app.set_has_result(false);
        app.set_can_open(false);
        app.set_artifact("".into());
        app.set_change_summary("".into());
        app.set_changed_count(0);
        app.set_diff_blocks(ModelRc::default());
        set_activity(app, "".into());
    }
    output_rows(app, state);
    sync_operation_ui(app, state);
}

fn show_text(app: &AppWindow, state: &mut Workspace, text: &str, markdown: bool) {
    state.showing = project::display_text(text, &state.root);
    app.set_result_blocks(ModelRc::new(VecModel::from(presentation::blocks(
        &state.showing,
        markdown,
    ))));
    app.set_has_result(true);
}

fn show_file_text(app: &AppWindow, state: &mut Workspace, text: &str, path: &std::path::Path) {
    let language = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    let markdown = language.eq_ignore_ascii_case("md");
    show_text(app, state, text, markdown);
    if !markdown {
        app.set_result_blocks(ModelRc::new(VecModel::from(presentation::code_blocks(
            &state.showing,
            language,
        ))));
    }
}

fn show_result(app: &AppWindow, state: &mut Workspace) {
    state.selected = None;
    app.set_previewing(false);
    app.set_result_title("Task result".into());
    app.set_can_open(state.viewing_output.is_none() && state.artifact.is_some());
    if let Some(output) = state.viewing_output.as_ref() {
        app.set_artifact(
            format!(
                "{} · {} · {} · {}",
                output.when, output.harness, output.status, output.elapsed
            )
            .into(),
        );
        let text = output.response.clone();
        show_text(app, state, &text, true);
        return;
    }
    app.set_change_summary(state.current_summary.clone().into());
    app.set_artifact(
        state
            .artifact
            .as_ref()
            .map(|path| format!("Saved to {}", project::relative_name(path)))
            .unwrap_or_default()
            .into(),
    );
    let result = state.result.clone();
    show_text(app, state, &result, true);
    refresh(app, state);
}

fn show_saved_output(app: &AppWindow, state: &mut Workspace, output: history::Output) {
    state.selected = None;
    app.set_browsing_history(true);
    app.set_active_tab(0);
    app.set_editing_task(false);
    app.set_task_title(output.title.clone().into());
    app.set_task_instructions(output.instructions.clone().into());
    app.set_task_attachments(ModelRc::new(VecModel::from(
        output
            .attachments
            .iter()
            .map(|path| project::relative_name(path).into())
            .collect::<Vec<_>>(),
    )));
    app.set_viewed_status(output.status.clone().into());
    app.set_viewed_elapsed(output.elapsed.clone().into());
    set_activity(app, output.activity.clone().into());
    app.set_changed_count(output.changed_count);
    app.set_diff_blocks(ModelRc::new(VecModel::from(
        output
            .diff
            .iter()
            .map(|(text, kind)| ResultBlock {
                content: slint::StyledText::from_plain_text(text),
                kind: *kind,
            })
            .collect::<Vec<_>>(),
    )));
    app.set_can_open(false);
    app.set_change_summary(output.summary.clone().into());
    app.set_result_title(output.title.clone().into());
    app.set_artifact(
        format!(
            "{} · {} · {} · {}",
            output.when, output.harness, output.status, output.elapsed
        )
        .into(),
    );
    let text = output
        .artifact_text
        .as_ref()
        .unwrap_or(&output.response)
        .clone();
    app.set_previewing(output.artifact_text.is_some());
    let artifact = output
        .artifact
        .clone()
        .filter(|_| output.artifact_text.is_some());
    state.viewing_output = Some(output);
    if let Some(path) = artifact {
        show_file_text(app, state, &text, &path);
    } else {
        show_text(app, state, &text, true);
    }
    output_rows(app, state);
    refresh(app, state);
    sync_operation_ui(app, state);
}

fn preview_file(
    app: &AppWindow,
    state: &mut Workspace,
    relative: PathBuf,
    saved: bool,
) -> Result<(), String> {
    let text = project::read_text(&state.root, &relative)?;
    if state.viewing_output.is_some() {
        show_latest(app, state);
    }
    state.viewing_output = None;
    app.set_browsing_history(false);
    app.set_change_summary(state.current_summary.clone().into());
    show_file_text(app, state, &text, &relative);
    app.set_previewing(true);
    app.set_active_tab(0);
    app.set_can_open(true);
    app.set_result_title(project::relative_name(&relative).into());
    app.set_artifact(
        if saved {
            format!("Saved to {}", project::relative_name(&relative))
        } else {
            String::new()
        }
        .into(),
    );
    state.selected = Some(relative);
    app.set_notice("".into());
    Ok(())
}

fn elapsed(start: Instant) -> String {
    let seconds = start.elapsed().as_secs();
    format!("{:02}:{:02}", seconds / 60, seconds % 60)
}

fn start_execution(
    app: &AppWindow,
    state: &mut Workspace,
    harness: &str,
    instructions: String,
    command: std::process::Command,
    prompt: String,
    sender: mpsc::Sender<Event>,
) {
    if let Some(worker) = state.worker.take() {
        let _ = worker.join();
    }
    state.control = runner::Control::default();
    state.started = Some(Instant::now());
    state.activity.clear();
    state.changes.clear();
    state.selected = None;
    state.artifact = None;
    state.result.clear();
    state.showing.clear();
    state.current_summary.clear();
    state.viewing_output = None;
    state.current_title = project::display_text(
        instructions
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Task output"),
        &state.root,
    )
    .chars()
    .take(70)
    .collect();
    if let Some(operation) = state
        .operation
        .as_ref()
        .filter(|operation| !operation.suspended && operation.phase != operation::Phase::Finished)
    {
        state.current_title = format!("Plan: {}", operation.target)
            .chars()
            .take(70)
            .collect();
    }
    state.current_harness = harness.to_string();
    state.current_instructions = instructions.to_string();
    app.set_instructions_text(instructions.clone().into());
    app.set_browsing_history(false);
    output_rows(app, state);
    app.set_running(true);
    app.set_active_tab(2);
    app.set_editing_task(true);
    app.set_task_title(state.current_title.clone().into());
    app.set_latest_title(state.current_title.clone().into());
    app.set_task_attachments(app.get_attachments());
    app.set_task_instructions(instructions.clone().into());
    app.set_changed_count(0);
    app.set_diff_blocks(ModelRc::default());
    app.set_has_result(false);
    app.set_previewing(false);
    app.set_can_open(false);
    app.set_notice("".into());
    app.set_status("Running".into());
    app.set_elapsed("00:00".into());
    app.set_artifact("".into());
    app.set_change_summary("".into());
    set_activity(
        app,
        format!("[00:00] Starting {harness} · fresh execution").into(),
    );
    let root = state.root.clone();
    let control = state.control.clone();
    let sender = sender.clone();
    let activity_sender = sender.clone();
    state.worker = Some(thread::spawn(move || {
        let before = project::snapshot(&root);
        let result = runner::execute(command, prompt, control, move |line| {
            let _ = activity_sender.send(Event::Activity(line));
        });
        let after = project::snapshot(&root);
        let _ = sender.send(Event::Done(result, before, after));
    }));
    refresh(app, state);
    sync_operation_ui(app, state);
}

fn inspect_command(app: &AppWindow, input: &str) {
    let first = input.lines().next().unwrap_or("");
    let token = first.split_whitespace().next().unwrap_or("");
    app.set_command_menu_open(
        first.starts_with('/')
            && !first.contains(char::is_whitespace)
            && "/plan".starts_with(first),
    );
    app.set_plan_command(token == "/plan");
    if token == "/plan" {
        let target = first
            .trim_start()
            .strip_prefix("/plan")
            .unwrap_or("")
            .trim()
            .trim_matches('"');
        if !target.is_empty() {
            app.set_operation_target(target.into());
        }
    }
}

fn save_operation(state: &Workspace) -> Result<(), String> {
    if let Some(operation) = &state.operation {
        history::Store::for_project(&state.root)?.save_operation(operation)?;
    }
    Ok(())
}

fn sync_operation_ui(app: &AppWindow, state: &Workspace) {
    let active = state
        .operation
        .as_ref()
        .filter(|op| !op.suspended && op.phase != operation::Phase::Finished);
    app.set_operation_active(active.is_some());
    app.set_operation_visible(active.is_some() && !app.get_browsing_history());
    app.set_plan_can_resume(
        state
            .operation
            .as_ref()
            .is_some_and(|op| op.suspended && op.phase != operation::Phase::Finished),
    );
    if let Some(operation) = active {
        app.set_plan_ready(operation.phase == operation::Phase::Ready);
        app.set_plan_can_continue(operation.can_continue());
        app.set_operation_feedback(operation.feedback.clone().into());
        app.set_operation_target(operation.target.clone().into());
        app.set_operation_summary(
            operation
                .last_error
                .clone()
                .or_else(|| {
                    operation
                        .checkpoint
                        .as_ref()
                        .map(|checkpoint| checkpoint.summary.clone())
                })
                .unwrap_or_else(|| "Planning will pause here when input is needed.".into())
                .into(),
        );
        app.set_questions(ModelRc::new(VecModel::from(
            operation
                .checkpoint
                .as_ref()
                .map(|checkpoint| {
                    checkpoint
                        .questions
                        .iter()
                        .map(|question| QuestionRow {
                            id: question.id.clone().into(),
                            text: question.text.clone().into(),
                            suggestions: question.suggestions.join("\n").into(),
                            references: question.references.join("\n").into(),
                            answer: operation
                                .answers
                                .get(&question.id)
                                .cloned()
                                .unwrap_or_default()
                                .into(),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        )));
    } else {
        app.set_plan_ready(false);
        app.set_plan_can_continue(false);
        app.set_questions(ModelRc::default());
    }
    if app.get_active_tab() == 3 && !app.get_operation_visible() {
        app.set_active_tab(0);
    }
}

fn display_operation(app: &AppWindow, state: &mut Workspace) {
    let Some(operation) = state.operation.clone() else {
        return;
    };
    app.set_browsing_history(false);
    state.viewing_output = None;
    app.set_editing_task(false);
    app.set_status(operation.phase.label().into());
    state.current_title = format!("Plan: {}", operation.target);
    state.current_instructions = format!("/plan {}\n{}", operation.target, operation.directions);
    app.set_task_title(state.current_title.clone().into());
    app.set_task_instructions(operation.target.clone().into());
    app.set_harness(operation.harness.clone().into());
    state.attachments = operation.attachments.clone();
    attachments(app, state);
    app.set_task_attachments(app.get_attachments());
    if let Some(checkpoint) = operation.checkpoint {
        state.result = checkpoint.summary;
        state.artifact = Some(operation.artifact.clone());
        show_file_text(app, state, &checkpoint.plan, &operation.artifact);
        app.set_previewing(true);
        app.set_result_title("Plan".into());
        app.set_can_open(project::read_text(&state.root, &operation.artifact).is_ok());
        app.set_artifact(project::relative_name(&operation.artifact).into());
    } else {
        app.set_has_result(false);
        app.set_can_open(false);
    }
    sync_operation_ui(app, state);
    app.set_active_tab(3);
}

fn load_operation(app: &AppWindow, state: &mut Workspace) {
    match history::Store::for_project(&state.root).and_then(|store| store.load_operation()) {
        Ok(operation) => {
            state.operation = operation;
            if state
                .operation
                .as_ref()
                .is_some_and(|op| !op.suspended && op.phase != operation::Phase::Finished)
            {
                display_operation(app, state);
            } else {
                sync_operation_ui(app, state);
            }
        }
        Err(error) => app.set_notice(error.into()),
    }
}

fn finish_operation_step(
    state: &mut Workspace,
    text: String,
    status: &'static str,
) -> (String, &'static str) {
    let Some(operation) = state
        .operation
        .as_mut()
        .filter(|op| !op.suspended && op.phase != operation::Phase::Finished)
    else {
        return (text, status);
    };
    let (text, status) = if status == "Completed" {
        match operation::Checkpoint::parse(&text)
            .and_then(|checkpoint| operation.apply(checkpoint, &state.root))
        {
            Ok(()) => (
                operation.checkpoint.as_ref().unwrap().summary.clone(),
                operation.phase.label(),
            ),
            Err(error) => {
                operation.phase = operation::Phase::Failed;
                (error, "Failed")
            }
        }
    } else {
        operation.phase = if status == "Stopped" {
            operation::Phase::Interrupted
        } else {
            operation::Phase::Failed
        };
        (text, status)
    };
    if let Some(operation) = &mut state.operation {
        operation.last_error = if status == "Failed" || status == "Stopped" {
            Some(text.clone())
        } else {
            None
        };
    }
    if let Err(error) = save_operation(state) {
        if let Some(operation) = &mut state.operation {
            operation.phase = operation::Phase::Failed;
        }
        return (format!("{text}\n\n{error}"), "Failed");
    }
    (text, status)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = AppWindow::new()?;
    let state = Rc::new(RefCell::new(Workspace::new(std::env::current_dir()?)));
    app.set_project_name(project::name(&state.borrow().root).into());
    refresh(&app, &mut state.borrow_mut());
    load_outputs(&app, &mut state.borrow_mut());
    load_operation(&app, &mut state.borrow_mut());
    let (sender, receiver) = mpsc::channel::<Event>();

    let weak = app.as_weak();
    app.on_inspect_command(move |input| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        inspect_command(&app, &input);
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_answer_question(move |index, answer| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() || app.get_browsing_history() {
            return;
        }
        let mut state = workspace.borrow_mut();
        let Some(op) = &mut state.operation else {
            return;
        };
        let id = op
            .checkpoint
            .as_ref()
            .and_then(|c| c.questions.get(index as usize))
            .map(|q| q.id.clone());
        if let Some(id) = id {
            if let Err(error) = op.answer(&id, answer.to_string()) {
                app.set_notice(error.into());
                return;
            }
            app.set_plan_can_continue(op.can_continue());
            if let Err(error) = save_operation(&state) {
                app.set_notice(error.into());
            }
        }
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_feedback_edited(move |feedback| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() || app.get_browsing_history() {
            return;
        }
        let mut state = workspace.borrow_mut();
        if let Some(op) = &mut state.operation {
            op.feedback = feedback.to_string();
            app.set_plan_can_continue(op.can_continue());
            if let Err(error) = save_operation(&state) {
                app.set_notice(error.into());
            }
        }
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_pause_plan(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() {
            return;
        }
        let mut state = workspace.borrow_mut();
        if let Some(op) = &mut state.operation {
            op.suspended = true;
        }
        if let Err(error) = save_operation(&state) {
            app.set_notice(error.into());
            return;
        }
        state.viewing_output = None;
        state.result.clear();
        state.artifact = None;
        state.selected = None;
        state.attachments.clear();
        attachments(&app, &state);
        app.set_browsing_history(false);
        app.set_status("Ready".into());
        app.set_elapsed("00:00".into());
        app.set_editing_task(true);
        app.set_has_result(false);
        app.set_can_open(false);
        app.set_artifact("".into());
        app.set_instructions_text("".into());
        app.set_operation_target("".into());
        sync_operation_ui(&app, &state);
        app.set_active_tab(0);
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_resume_plan(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() {
            return;
        }
        let mut state = workspace.borrow_mut();
        if let Some(op) = &mut state.operation {
            op.suspended = false;
        }
        if let Err(error) = save_operation(&state) {
            app.set_notice(error.into());
            return;
        }
        display_operation(&app, &mut state);
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_finish_plan(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() {
            return;
        }
        let mut state = workspace.borrow_mut();
        if let Some(op) = &mut state.operation {
            if op.phase != operation::Phase::Ready {
                return;
            }
            op.phase = operation::Phase::Finished;
        }
        if let Err(error) = save_operation(&state) {
            app.set_notice(error.into());
            return;
        }
        app.set_status("Completed".into());
        app.set_editing_task(true);
        app.set_instructions_text("".into());
        app.set_operation_target("".into());
        sync_operation_ui(&app, &state);
        app.set_active_tab(0);
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    let continuation_sender = sender.clone();
    app.on_continue_plan(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() || app.get_browsing_history() {
            return;
        }
        let mut state = workspace.borrow_mut();
        let Some(mut op) = state
            .operation
            .clone()
            .filter(|op| !op.suspended && op.phase != operation::Phase::Finished)
        else {
            return;
        };
        if !op.can_continue() {
            app.set_notice("Provide an answer or a new direction first.".into());
            return;
        }
        let prepared = op.prompt(&state.root).and_then(|prompt| {
            runner::command(&op.harness, &state.root).map(|command| (prompt, command))
        });
        let (prompt, command) = match prepared {
            Ok(value) => value,
            Err(error) => {
                app.set_notice(error.into());
                return;
            }
        };
        op.phase = operation::Phase::Working;
        let instructions = format!("/plan {}\n{}", op.target, op.directions);
        let harness = op.harness.clone();
        state.attachments = op.attachments.clone();
        state.operation = Some(op);
        if let Err(error) = save_operation(&state) {
            app.set_notice(error.into());
            return;
        }
        start_execution(
            &app,
            &mut state,
            &harness,
            instructions,
            command,
            prompt,
            continuation_sender.clone(),
        );
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_choose_folder(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let root = workspace.borrow().root.clone();
        if let Some(root) = rfd::FileDialog::new().set_directory(root).pick_folder() {
            let mut state = workspace.borrow_mut();
            state.root = root;
            state.operation = None;
            state.explorer = Explorer::default();
            state.attachments.clear();
            state.changes.clear();
            state.selected = None;
            state.artifact = None;
            state.result.clear();
            state.showing.clear();
            state.activity.clear();
            state.current_summary.clear();
            state.viewing_output = None;
            app.set_browsing_history(false);
            app.set_project_name(project::name(&state.root).into());
            app.set_has_result(false);
            app.set_previewing(false);
            app.set_can_open(false);
            app.set_artifact("".into());
            app.set_change_summary("".into());
            app.set_notice("".into());
            app.set_status("Ready".into());
            app.set_editing_task(true);
            app.set_active_tab(0);
            app.set_changed_count(0);
            app.set_diff_blocks(ModelRc::default());
            set_activity(&app, "".into());
            app.set_elapsed("00:00".into());
            attachments(&app, &state);
            refresh(&app, &mut state);
            load_outputs(&app, &mut state);
            load_operation(&app, &mut state);
        }
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_edit_task(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        if app.get_running() {
            return;
        }
        let mut state = workspace.borrow_mut();
        if let Some(output) = state.viewing_output.as_ref() {
            state.attachments = output.attachments.clone();
            attachments(&app, &state);
        }
        app.set_instructions_text(app.get_task_instructions());
        app.set_editing_task(true);
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_add_files(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let mut state = workspace.borrow_mut();
        if app.get_running() {
            return;
        }
        if let Some(files) = rfd::FileDialog::new()
            .set_directory(&state.root)
            .pick_files()
        {
            for file in files {
                match project::relative_file(&state.root, &file).and_then(|relative| {
                    project::read_text(&state.root, &relative).map(|_| relative)
                }) {
                    Ok(relative) => {
                        if !state.attachments.contains(&relative) {
                            state.attachments.push(relative);
                        }
                    }
                    Err(error) => app.set_notice(error.into()),
                }
            }
            attachments(&app, &state);
        }
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_attach_file(move |index| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        attach_file(&app, &mut workspace.borrow_mut(), index);
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_remove_attachment(move |index| {
        if let Some(app) = weak.upgrade() {
            let mut state = workspace.borrow_mut();
            if index >= 0 && (index as usize) < state.attachments.len() {
                state.attachments.remove(index as usize);
            }
            attachments(&app, &state);
        }
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    let execution_sender = sender.clone();
    app.on_execute(move |harness, instructions| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let mut state = workspace.borrow_mut();
        if app.get_running() {
            return;
        }
        if !app.get_editing_task()
            && let Some(output) = state.viewing_output.as_ref()
        {
            state.attachments = output.attachments.clone();
            attachments(&app, &state);
        }
        let prepared = (|| -> Result<_, String> {
            if state
                .operation
                .as_ref()
                .is_some_and(|op| !op.suspended && op.phase != operation::Phase::Finished)
            {
                return Err(
                    "Pause or finish the current planning operation before starting another task."
                        .into(),
                );
            }
            let input = operation::parse(&instructions, &app.get_operation_target())?;
            let command = runner::command(&harness, &state.root)?;
            let prompt = match input {
                operation::Input::Task => {
                    project::prompt(&instructions, &state.root, &state.attachments)?
                }
                operation::Input::Plan { target, directions } => {
                    let op = operation::Operation::new(
                        target,
                        directions,
                        state.attachments.clone(),
                        harness.to_string(),
                    );
                    let prompt = op.prompt(&state.root)?;
                    history::Store::for_project(&state.root)?.save_operation(&op)?;
                    state.operation = Some(op);
                    prompt
                }
            };
            Ok((command, prompt))
        })();
        let (command, prompt) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                app.set_notice(error.into());
                return;
            }
        };
        start_execution(
            &app,
            &mut state,
            &harness,
            instructions.to_string(),
            command,
            prompt,
            execution_sender.clone(),
        );
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_stop_task(move || {
        workspace.borrow().control.cancel();
        if let Some(app) = weak.upgrade() {
            app.set_status("Stopping…".into());
        }
    });

    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_select_file(move |index| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let mut state = workspace.borrow_mut();
        let Some(row) = state.explorer.rows.get(index as usize) else {
            return;
        };
        let relative = row.relative.clone();
        if row.directory {
            if !state.explorer.expanded.remove(&relative) {
                state.explorer.expanded.insert(relative);
            }
        } else if !app.get_running()
            && let Err(error) = preview_file(&app, &mut state, relative, false)
        {
            app.set_notice(error.into());
        }
        refresh(&app, &mut state);
        output_rows(&app, &state);
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_select_output(move |index| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let mut state = workspace.borrow_mut();
        if let Some(output) = state.outputs.get(index as usize).cloned() {
            show_saved_output(&app, &mut state, output);
        }
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_show_latest(move || {
        let Some(app) = weak.upgrade() else {
            return;
        };
        show_latest(&app, &mut workspace.borrow_mut());
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_show_result(move || {
        if let Some(app) = weak.upgrade() {
            show_result(&app, &mut workspace.borrow_mut());
        }
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_copy_output(move || {
        if let Some(app) = weak.upgrade() {
            let result = arboard::Clipboard::new()
                .and_then(|mut clipboard| clipboard.set_text(workspace.borrow().showing.clone()));
            app.set_notice(
                if result.is_ok() {
                    "Copied"
                } else {
                    "Could not copy to the clipboard"
                }
                .into(),
            );
        }
    });
    let weak = app.as_weak();
    let workspace = state.clone();
    app.on_open_file(move || {
        if let Some(app) = weak.upgrade() {
            let state = workspace.borrow();
            if let Some(path) = state.selected.as_ref().or(state.artifact.as_ref())
                && let Err(error) = project::open_file(&state.root, path)
            {
                app.set_notice(error.into());
            }
        }
    });

    let timer = slint::Timer::default();
    let weak = app.as_weak();
    let workspace = state.clone();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(100),
        move || {
            let Some(app) = weak.upgrade() else {
                return;
            };
            let mut state = workspace.borrow_mut();
            if app.get_drag_index() < 0 && state.last_refresh.elapsed() >= Duration::from_secs(2) {
                refresh(&app, &mut state);
            }
            if app.get_running()
                && let Some(start) = state.started
            {
                app.set_elapsed(elapsed(start).into());
            }
            let mut activity_changed = false;
            for event in receiver.try_iter().take(200) {
                match event {
                    Event::Activity(line) => {
                        let timestamp = state.started.map(elapsed).unwrap_or_default();
                        let line = project::display_text(&line, &state.root);
                        state.activity.push_back(format!("[{timestamp}] {line}"));
                        while state.activity.len() > 500 {
                            state.activity.pop_front();
                        }
                        activity_changed = true;
                    }
                    Event::Done(result, before, after) => {
                        let (text, status) = match result {
                            Ok(result) => (
                                result.text,
                                if result.stopped {
                                    "Stopped"
                                } else if result.success {
                                    "Completed"
                                } else {
                                    "Failed"
                                },
                            ),
                            Err(error) => (error, "Failed"),
                        };
                        let planning = state.operation.as_ref().is_some_and(|op| {
                            !op.suspended && op.phase != operation::Phase::Finished
                        });
                        let (text, status) = finish_operation_step(&mut state, text, status);
                        let after = if planning {
                            project::snapshot(&state.root)
                        } else {
                            after
                        };
                        state.changes = project::changes(&before, &after);
                        let diff = project::diff_blocks(&before, &after);
                        let saved_diff = diff.clone();
                        let changed_paths: Vec<_> = state
                            .changes
                            .iter()
                            .filter(|(_, change)| **change != Change::Removed)
                            .map(|(path, _)| path.clone())
                            .collect();
                        for path in &changed_paths {
                            state.explorer.reveal(path);
                        }
                        state.artifact = changed_paths
                            .iter()
                            .find(|path| {
                                path.starts_with("output")
                                    && path
                                        .extension()
                                        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                            })
                            .or_else(|| {
                                changed_paths.iter().find(|path| {
                                    path.extension()
                                        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                                })
                            })
                            .or_else(|| {
                                changed_paths
                                    .iter()
                                    .find(|path| project::read_text(&state.root, path).is_ok())
                            })
                            .cloned();
                        if planning
                            && let Some(op) = state
                                .operation
                                .as_ref()
                                .filter(|op| op.checkpoint.is_some())
                        {
                            state.artifact = Some(op.artifact.clone());
                        }
                        let summary = project::change_summary(
                            &state.changes,
                            before.limited || after.limited,
                        );
                        state.current_summary = summary.clone();
                        state.result = text;
                        app.set_running(false);
                        app.set_status(status.into());
                        if state.viewing_output.is_none() {
                            app.set_active_tab(0);
                            app.set_editing_task(
                                app.get_instructions_text().as_str() != state.current_instructions,
                            );
                            app.set_changed_count(state.changes.len() as i32);
                            app.set_diff_blocks(ModelRc::new(VecModel::from(
                                diff.iter()
                                    .map(|(text, kind)| ResultBlock {
                                        content: slint::StyledText::from_plain_text(text),
                                        kind: *kind,
                                    })
                                    .collect::<Vec<_>>(),
                            )));
                        }
                        let output = history::Output {
                            id: format!(
                                "unsaved-{}",
                                chrono::Local::now()
                                    .timestamp_nanos_opt()
                                    .unwrap_or_default()
                            ),
                            title: state.current_title.clone(),
                            when: chrono::Local::now().format("%b %d · %H:%M").to_string(),
                            harness: state.current_harness.clone(),
                            status: status.into(),
                            elapsed: app.get_elapsed().to_string(),
                            response: state.result.clone(),
                            artifact: state.artifact.clone(),
                            artifact_text: if matches!(
                                status,
                                "Completed" | "Needs input" | "No remaining questions"
                            ) {
                                state
                                    .artifact
                                    .as_ref()
                                    .and_then(|path| project::read_text(&state.root, path).ok())
                            } else {
                                None
                            },
                            summary: summary.clone(),
                            instructions: state.current_instructions.clone(),
                            attachments: state.attachments.clone(),
                            activity: state
                                .activity
                                .iter()
                                .cloned()
                                .collect::<Vec<_>>()
                                .join("\n"),
                            changed_count: state.changes.len() as i32,
                            diff: saved_diff,
                            operation: state.operation.clone().filter(|op| {
                                !op.suspended && op.phase != operation::Phase::Finished
                            }),
                        };
                        let (output, save_error) = match history::Store::for_project(&state.root)
                            .and_then(|store| store.save(output.clone()))
                        {
                            Ok(saved) => (saved, None),
                            Err(error) => (output, Some(error)),
                        };
                        state.outputs.insert(0, output);
                        output_rows(&app, &state);
                        if state.viewing_output.is_none() {
                            app.set_change_summary(summary.into());
                            show_result(&app, &mut state);
                        }
                        if state.viewing_output.is_none()
                            && status == "Completed"
                            && let Some(path) = state.artifact.clone()
                            && preview_file(&app, &mut state, path, true).is_ok()
                        {
                            refresh(&app, &mut state);
                        }
                        sync_operation_ui(&app, &state);
                        if planning && state.viewing_output.is_none() {
                            let diagnostic = state.result.clone();
                            display_operation(&app, &mut state);
                            if status == "Failed" || status == "Stopped" {
                                state.result = diagnostic.clone();
                                app.set_operation_summary(diagnostic.into());
                            }
                        }
                        if let Some(error) = save_error {
                            app.set_notice(error.into());
                        }
                    }
                }
            }
            if activity_changed && state.viewing_output.is_none() {
                set_activity(
                    &app,
                    state
                        .activity
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("\n")
                        .into(),
                );
            }
        },
    );

    let result = app.run();
    timer.stop();
    let mut state = state.borrow_mut();
    state.control.cancel();
    if let Some(worker) = state.worker.take() {
        let _ = worker.join();
    }
    result?;
    Ok(())
}
