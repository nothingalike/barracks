use super::*;
use slint::Model;
use slint::platform::{
    Platform, WindowAdapter,
    software_renderer::{MinimalSoftwareWindow, RepaintBufferType},
};

struct Offscreen(Rc<MinimalSoftwareWindow>);

impl Platform for Offscreen {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.0.clone())
    }
}

fn capture(
    app: &AppWindow,
    window: &MinimalSoftwareWindow,
    name: &str,
    width: u32,
    height: u32,
) -> slint::SharedPixelBuffer<slint::Rgb8Pixel> {
    app.window()
        .set_size(slint::PhysicalSize::new(width, height));
    slint::platform::update_timers_and_animations();
    app.window().request_redraw();
    let mut pixels = slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(width, height);
    assert!(window.draw_if_needed(|renderer| {
        renderer.render(pixels.make_mut_slice(), width as usize);
    }));
    assert!(
        pixels.as_slice().windows(2).any(|pair| pair[0] != pair[1]),
        "The rendered screen is empty"
    );
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/ui-previews");
    std::fs::create_dir_all(&folder).unwrap();
    image::save_buffer(
        folder.join(format!("{name}.png")),
        pixels.as_bytes(),
        width,
        height,
        image::ColorType::Rgb8,
    )
    .unwrap();
    pixels
}

#[test]
fn renders_running_completed_and_compact_states_without_a_desktop_window() {
    let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
    slint::platform::set_platform(Box::new(Offscreen(window.clone()))).unwrap();
    let app = AppWindow::new().unwrap();
    app.set_project_name("example".into());
    let mut workspace = Workspace::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let archived = history::Output {
        id: "saved-one".into(),
        title: "Implementation plan".into(),
        when: "Nov 18 · 09:00".into(),
        harness: "Codex".into(),
        status: "Completed".into(),
        elapsed: "00:24".into(),
        response: "Original model response".into(),
        artifact: Some("output/plan.md".into()),
        artifact_text: Some("# Original saved plan".into()),
        summary: "1 created".into(),
        operation: None,
        instructions: String::new(),
        attachments: Vec::new(),
        activity: String::new(),
        changed_count: 0,
        diff: Vec::new(),
    };
    workspace.outputs.push(archived.clone());
    app.set_running(true);
    show_saved_output(&app, &mut workspace, archived);
    assert!(app.get_browsing_history());
    assert_eq!(workspace.showing, "# Original saved plan");
    assert!(!app.get_can_open());
    show_result(&app, &mut workspace);
    assert_eq!(workspace.showing, "Original model response");
    assert!(
        app.get_running(),
        "Reading history must not stop the active task"
    );
    workspace.current_title = "Current task".into();
    workspace.current_instructions = "Current instructions".into();
    workspace.activity.push_back("[00:02] Current event".into());
    show_latest(&app, &mut workspace);
    assert!(!app.get_browsing_history());
    assert_eq!(app.get_active_tab(), 2);
    assert_eq!(app.get_task_title().as_str(), "Current task");
    assert_eq!(app.get_activity().as_str(), "[00:02] Current event");
    assert!(
        !app.get_has_result(),
        "Returning to live activity must hide the old result"
    );
    app.set_browsing_history(false);
    app.set_has_result(false);
    app.set_previewing(false);
    app.set_change_summary("".into());
    app.set_artifact("".into());
    app.set_saved_outputs(ModelRc::new(VecModel::from(vec![
        OutputRow {
            title: "Implementation plan".into(),
            detail: "Nov 18 · 09:00 · Completed".into(),
            selected: false,
        },
        OutputRow {
            title: "Review project structure".into(),
            detail: "Nov 18 · 08:42 · Completed".into(),
            selected: false,
        },
        OutputRow {
            title: "Inspect test coverage".into(),
            detail: "Nov 17 · 16:20 · Completed".into(),
            selected: false,
        },
    ])));
    app.set_latest_title("Generate implementation plan".into());
    app.set_instructions_text(
        "Review the project and generate an implementation plan. Save the plan to output/plan.md."
            .into(),
    );
    app.set_attachments(ModelRc::new(VecModel::from(vec!["README.md".into()])));
    app.set_files(ModelRc::new(VecModel::from(vec![
        FileRow {
            name: "src".into(),
            directory: true,
            expanded: true,
            ..Default::default()
        },
        FileRow {
            name: "main.rs".into(),
            depth: 1,
            ..Default::default()
        },
        FileRow {
            name: "runner.rs".into(),
            depth: 1,
            ..Default::default()
        },
        FileRow {
            name: "project.rs".into(),
            depth: 1,
            ..Default::default()
        },
        FileRow {
            name: "output".into(),
            directory: true,
            expanded: true,
            ..Default::default()
        },
        FileRow {
            name: "plan.md".into(),
            depth: 1,
            selected: true,
            change: 1,
            ..Default::default()
        },
        FileRow {
            name: "Cargo.toml".into(),
            ..Default::default()
        },
        FileRow {
            name: "README.md".into(),
            ..Default::default()
        },
    ])));
    app.show().unwrap();
    app.set_running(true);
    app.set_status("Running".into());
    app.set_active_tab(2);
    app.set_editing_task(true);
    app.set_elapsed("00:18".into());
    set_activity(&app, "[00:00] Starting Codex · fresh execution\n[00:03] Running: reading project files\n[00:07] Finished: inspect src/main.rs\n[00:12] Tool: review test coverage\n[00:18] Drafting implementation plan…".into());
    capture(&app, &window, "running", 1180, 860);
    app.set_running(false);
    app.set_has_result(true);
    app.set_status("Completed".into());
    app.set_elapsed("00:24".into());
    app.set_result_title("plan.md".into());
    app.set_previewing(true);
    app.set_artifact("Saved to output/plan.md".into());
    app.set_can_open(true);
    app.set_change_summary("1 created · 0 updated · 0 removed".into());
    app.set_result_blocks(ModelRc::new(VecModel::from(presentation::blocks("# Implementation plan\n\n1. **Separate execution from presentation**\n- Move harness execution into the runner.\n\n2. **Add a project file explorer**\n- Show project files and generated artifacts.\n\n3. **Replace activity with the final result**\n- Stream events while running, then render the output.", true))));
    app.set_active_tab(0);
    app.set_editing_task(false);
    app.set_task_title("Generate implementation plan".into());
    app.set_task_instructions(app.get_instructions_text());
    capture(&app, &window, "completed", 1180, 860);
    app.set_task_attachments(app.get_attachments());
    let original_files = app.get_files();
    let original_outputs = app.get_saved_outputs();
    app.set_files(ModelRc::new(VecModel::from(vec![
        FileRow {
            name: "ui".into(),
            directory: true,
            ..Default::default()
        },
        FileRow {
            name: "Cargo.toml".into(),
            ..Default::default()
        },
        FileRow {
            name: "hello.txt".into(),
            selected: true,
            change: 2,
            ..Default::default()
        },
        FileRow {
            name: "README.md".into(),
            ..Default::default()
        },
    ])));
    app.set_saved_outputs(ModelRc::new(VecModel::from(vec![
        OutputRow {
            title: "Update greeting".into(),
            detail: "Nov 18 / Completed".into(),
            selected: true,
        },
        OutputRow {
            title: "Create hello.txt".into(),
            detail: "Nov 18 / Completed".into(),
            selected: false,
        },
    ])));
    app.set_task_attachments(ModelRc::new(VecModel::from(vec!["hello.txt".into()])));
    app.set_change_summary("0 created / 1 updated / 0 removed".into());
    app.set_task_title("Update greeting".into());
    app.set_task_instructions("Update this file to say hello kyle".into());
    app.set_result_title("hello.txt".into());
    app.set_artifact("example / hello.txt".into());
    app.set_result_blocks(ModelRc::new(VecModel::from(presentation::blocks(
        "1    hello kyle",
        false,
    ))));
    app.set_changed_count(1);
    let diff = vec![
        ("hello.txt / Updated", 0),
        ("@@ -1,1 +1,1 @@", 0),
        ("-    1  hello world", 6),
        ("+    1  hello kyle", 5),
    ];
    app.set_diff_blocks(ModelRc::new(VecModel::from(
        diff.into_iter()
            .map(|(text, kind)| ResultBlock {
                content: slint::StyledText::from_plain_text(text),
                kind,
            })
            .collect::<Vec<_>>(),
    )));
    capture(&app, &window, "greeting-preview", 1180, 860);
    use slint::platform::{PointerEventButton, WindowEvent};
    let changes_tab = slint::LogicalPosition::new(200., 342.);
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: changes_tab,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: changes_tab,
        button: PointerEventButton::Left,
    });
    assert_eq!(app.get_active_tab(), 1, "Clicking Changes must switch tabs");
    capture(&app, &window, "greeting-changes", 1180, 860);
    capture(&app, &window, "changes-compact", 850, 720);
    app.set_active_tab(0);
    app.set_files(original_files);
    app.set_saved_outputs(original_outputs);
    // Dispatch input to the software window, never to the user's desktop.
    let attach_workspace = Rc::new(RefCell::new(Workspace::new(PathBuf::from(env!(
        "CARGO_MANIFEST_DIR"
    )))));
    attach_workspace.borrow_mut().explorer.rows = vec![
        project::FileEntry {
            relative: "src".into(),
            name: "src".into(),
            depth: 0,
            directory: true,
            expanded: true,
        },
        project::FileEntry {
            relative: "src/main.rs".into(),
            name: "main.rs".into(),
            depth: 1,
            directory: false,
            expanded: false,
        },
    ];
    let weak = app.as_weak();
    let attached = attach_workspace.clone();
    app.on_attach_file(move |index| {
        if let Some(app) = weak.upgrade() {
            attach_file(&app, &mut attached.borrow_mut(), index);
        }
    });
    let previews = Rc::new(std::cell::Cell::new(0));
    let preview_count = previews.clone();
    app.on_select_file(move |_| preview_count.set(preview_count.get() + 1));
    app.set_editing_task(true);
    capture(&app, &window, "editing", 1180, 860);
    let source = slint::LogicalPosition::new(1000., 233.);
    let target = slint::LogicalPosition::new(400., 160.);
    app.window()
        .dispatch_event(WindowEvent::PointerMoved { position: source });
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: source,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerMoved {
        position: slint::LogicalPosition::new(985., 233.),
    });
    app.window()
        .dispatch_event(WindowEvent::PointerMoved { position: target });
    assert_eq!(app.get_drag_index(), 1, "The file row must start a drag");
    assert!(
        app.get_drop_ready(),
        "Instructions must accept a dragged file"
    );
    capture(&app, &window, "attaching-file", 1180, 860);
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: target,
        button: PointerEventButton::Left,
    });
    assert_eq!(app.get_drag_index(), -1);
    assert_eq!(
        attach_workspace.borrow().attachments,
        [PathBuf::from("src/main.rs")]
    );
    assert_eq!(
        previews.get(),
        0,
        "Dragging must not also open the file preview"
    );
    app.invoke_attach_file(1);
    assert_eq!(
        attach_workspace.borrow().attachments.len(),
        1,
        "Repeated attachment is deduplicated"
    );
    // Dropping outside the instructions must not attach another file.
    attach_workspace.borrow_mut().attachments.clear();
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: source,
        button: PointerEventButton::Left,
    });
    let outside = slint::LogicalPosition::new(700., 600.);
    app.window()
        .dispatch_event(WindowEvent::PointerMoved { position: outside });
    assert!(!app.get_drop_ready());
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: outside,
        button: PointerEventButton::Left,
    });
    assert!(attach_workspace.borrow().attachments.is_empty());
    // The row's + button must attach without opening the file preview.
    let plus = slint::LogicalPosition::new(1130., 233.);
    app.window()
        .dispatch_event(WindowEvent::PointerMoved { position: plus });
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: plus,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: plus,
        button: PointerEventButton::Left,
    });
    assert_eq!(
        attach_workspace.borrow().attachments,
        [PathBuf::from("src/main.rs")]
    );
    assert_eq!(previews.get(), 0);
    attach_workspace.borrow_mut().attachments.clear();
    let scrollbar = slint::LogicalPosition::new(1155., 233.);
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: scrollbar,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: scrollbar,
        button: PointerEventButton::Left,
    });
    assert!(
        attach_workspace.borrow().attachments.is_empty(),
        "The scrollbar gutter must not activate Add to context"
    );
    app.set_notice("".into());
    app.set_attachments(ModelRc::new(VecModel::from(vec!["README.md".into()])));
    app.set_editing_task(false);
    capture(&app, &window, "completed-compact", 850, 720);
    app.set_explorer_open(false);
    capture(&app, &window, "explorer-collapsed", 1180, 860);
    app.set_outputs_open(false);
    app.set_options_open(true);
    app.set_harness("Claude Code".into());
    capture(&app, &window, "options", 1180, 860);
    app.set_options_open(false);
    assert_eq!(
        app.get_harness().as_str(),
        "Claude Code",
        "Closing options must preserve the harness choice"
    );
    app.set_explorer_open(true);
    app.set_outputs_open(true);
    app.set_active_tab(0);
    let code = "// Greeting example\nfn main() {\n    let count = 42;\n    let greeting = \"hello kyle\";\n    println!(\"{greeting}: {count}\");\n}\n";
    show_file_text(
        &app,
        &mut workspace,
        code,
        std::path::Path::new("src/main.rs"),
    );
    assert_eq!(workspace.showing, code, "Copy must retain the literal code");
    app.set_result_title("src/main.rs".into());
    app.set_artifact("example / src/main.rs".into());
    let code_pixels = capture(&app, &window, "code-preview", 1180, 860);
    assert_icon_centered(&code_pixels, (1136, 4, 36, 36));
    assert_icon_centered(&code_pixels, (1116, 220, 26, 26));
    let gear = slint::LogicalPosition::new(1154., 22.);
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: gear,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: gear,
        button: PointerEventButton::Left,
    });
    assert!(
        app.get_options_open(),
        "Clicking the centered gear must still open Options"
    );
    app.set_options_open(false);
    assert!(
        code_pixels
            .as_slice()
            .iter()
            .any(|p| p.r == 197 && p.g == 165 && p.b == 223),
        "The rendered preview must contain keyword colors"
    );
    assert!(
        code_pixels
            .as_slice()
            .iter()
            .any(|p| p.r == 219 && p.g == 169 && p.b == 132),
        "The rendered preview must contain string colors"
    );
    capture(&app, &window, "code-preview-compact", 850, 720);
    app.set_active_tab(2);
    let log = (0..50)
        .map(|index| format!("[00:{index:02}] Activity event {index}"))
        .collect::<Vec<_>>()
        .join("\n");
    set_activity(&app, log.clone().into());
    capture(&app, &window, "activity-tail", 1180, 860);
    let previous_offset = app.get_activity_scroll_offset();
    assert!(
        previous_offset < -1000.,
        "An overflowing activity log must follow the bottom, offset={previous_offset}"
    );
    app.window().dispatch_event(WindowEvent::PointerScrolled {
        position: slint::LogicalPosition::new(500., 550.),
        delta_x: 0.,
        delta_y: 400.,
    });
    capture(&app, &window, "activity-scrolled-up", 1180, 860);
    assert!(
        app.get_activity_scroll_offset() > previous_offset,
        "The user can inspect earlier events"
    );
    set_activity(&app, format!("{log}\n[01:00] Newest activity event").into());
    capture(&app, &window, "activity-tail-appended", 1180, 860);
    assert!(
        app.get_activity_scroll_offset() < previous_offset,
        "Appending a log event must advance the viewport"
    );
    let bottom = app.get_activity_scroll_offset();
    app.window().dispatch_event(WindowEvent::PointerScrolled {
        position: slint::LogicalPosition::new(500., 550.),
        delta_x: 0.,
        delta_y: 400.,
    });
    capture(&app, &window, "activity-before-replacement", 1180, 860);
    // The production log eventually evicts its oldest row without changing height.
    let replaced = format!(
        "{}\n[01:00] Newest activity event\n[01:01] Latest activity event",
        log.lines().skip(1).collect::<Vec<_>>().join("\n")
    );
    set_activity(&app, replaced.into());
    capture(&app, &window, "activity-tail-replaced", 1180, 860);
    assert!(
        (app.get_activity_scroll_offset() - bottom).abs() < 1.,
        "Replacing a capped log must return to the bottom even when content height stays constant"
    );
    app.set_operation_active(false);
    app.set_project_name("barracks".into());
    app.set_elapsed("00:00".into());
    app.set_artifact("".into());
    app.set_change_summary("".into());
    app.set_editing_task(true);
    app.set_status("Ready".into());
    app.set_active_tab(0);
    app.set_has_result(false);
    let weak = app.as_weak();
    app.on_inspect_command(move |input| {
        if let Some(app) = weak.upgrade() {
            inspect_command(&app, &input);
        }
    });
    app.set_instructions_text("/".into());
    capture(&app, &window, "operation-command-menu", 1180, 860);
    assert!(app.get_command_menu_open());
    app.set_instructions_text("/plan ".into());
    app.set_operation_target("project/stories/EX-002.md".into());
    capture(&app, &window, "operation-start", 1180, 860);
    assert!(app.get_plan_command());
    let checkpoint = serde_json::json!({"status":"needs_input","summary":"The plan keeps the existing modules. One decision needs your input.","plan":"# Plan\n## Architecture\nReuse existing modules.\n## Models\nStorage pending.\n## Workflow\nCollect a storage decision.\n## Questions\nWhere should notes be saved?","questions":[{"id":"storage","text":"Where should notes be saved?","suggestions":["JSON file for a small local tool","SQLite for structured queries"],"references":["project/stories/EX-002.md","src/history.rs"]}]});
    let mut operation = operation::Operation::new(
        "project/stories/EX-002.md".into(),
        String::new(),
        vec![],
        "Codex".into(),
    );
    operation.phase = operation::Phase::NeedsInput;
    operation.checkpoint = Some(operation::Checkpoint::parse(&checkpoint.to_string()).unwrap());
    workspace.operation = Some(operation);
    display_operation(&app, &mut workspace);
    assert!(app.get_operation_visible());
    assert!(
        !app.get_plan_can_continue(),
        "Suggestions must remain unselected"
    );
    assert_eq!(app.get_questions().row_data(0).unwrap().answer.as_str(), "");
    capture(&app, &window, "operation-questions", 1180, 860);
    capture(&app, &window, "operation-questions-compact", 850, 720);
    capture(&app, &window, "operation-question-input", 1180, 860);
    let entered_answer = Rc::new(RefCell::new(String::new()));
    let captured_answer = entered_answer.clone();
    app.on_answer_question(move |index, text| {
        assert_eq!(index, 0);
        *captured_answer.borrow_mut() = text.to_string();
    });
    let answer_field = slint::LogicalPosition::new(150., 570.);
    app.window().dispatch_event(WindowEvent::PointerPressed {
        position: answer_field,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::PointerReleased {
        position: answer_field,
        button: PointerEventButton::Left,
    });
    app.window().dispatch_event(WindowEvent::KeyPressed {
        text: "JSON".into(),
    });
    app.window().dispatch_event(WindowEvent::KeyReleased {
        text: "JSON".into(),
    });
    assert_eq!(
        &*entered_answer.borrow(),
        "JSON",
        "Typing in the answer field must reach the operation input callback"
    );
    workspace
        .operation
        .as_mut()
        .unwrap()
        .answer("storage", "Use JSON file storage.".into())
        .unwrap();
    sync_operation_ui(&app, &workspace);
    assert!(app.get_plan_can_continue());
    assert_eq!(
        app.get_questions().row_data(0).unwrap().answer.as_str(),
        "Use JSON file storage."
    );
    app.set_browsing_history(true);
    sync_operation_ui(&app, &workspace);
    assert!(
        !app.get_operation_visible(),
        "History snapshots must not expose live operation controls"
    );
    app.set_browsing_history(false);
    sync_operation_ui(&app, &workspace);
    assert!(app.get_operation_visible());
    app.hide().unwrap();
}

fn assert_icon_centered(
    pixels: &slint::SharedPixelBuffer<slint::Rgb8Pixel>,
    (x, y, width, height): (u32, u32, u32, u32),
) {
    let mut ink = Vec::new();
    for row in y + 3..y + height - 3 {
        for column in x + 3..x + width - 3 {
            let pixel = pixels.as_slice()[(row * pixels.width() + column) as usize];
            if pixel.r > 130 && pixel.g > 140 && pixel.b > 140 {
                ink.push((column, row));
            }
        }
    }
    assert!(!ink.is_empty(), "The button icon must be visible");
    let center_x = (ink.iter().map(|p| p.0).min().unwrap()
        + ink.iter().map(|p| p.0).max().unwrap()
        + 1) as f32
        / 2.;
    let center_y = (ink.iter().map(|p| p.1).min().unwrap()
        + ink.iter().map(|p| p.1).max().unwrap()
        + 1) as f32
        / 2.;
    assert!(
        (center_x - (x as f32 + width as f32 / 2.)).abs() <= 1.,
        "Icon must be horizontally centered inside its button: center={center_x}, button center={}",
        x as f32 + width as f32 / 2.
    );
    assert!(
        (center_y - (y as f32 + height as f32 / 2.)).abs() <= 1.,
        "Icon must be vertically centered inside its button: center={center_y}"
    );
}
