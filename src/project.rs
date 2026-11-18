use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::SystemTime,
};

const MAX_FILES: usize = 10_000;
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const SKIP: &[&str] = &[
    ".git",
    ".state",
    "target",
    "node_modules",
    "dist",
    "bin",
    "obj",
    ".venv",
    "__pycache__",
];

pub fn name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Project".into())
}

pub fn relative_name(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn display_text(text: &str, root: &Path) -> String {
    let absolute = root.to_string_lossy();
    text.replace(absolute.as_ref(), &name(root))
        .replace(&absolute.replace('\\', "/"), &name(root))
}

fn resolve(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "The project folder is unavailable.".to_owned())?;
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "The selected file is unavailable.".to_owned())?;
    if !path.starts_with(&root) {
        return Err("Choose a file inside the selected project.".into());
    }
    Ok(path)
}

pub fn relative_file(root: &Path, file: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "The project folder is unavailable.".to_owned())?;
    let file = file
        .canonicalize()
        .map_err(|_| "The selected file is unavailable.".to_owned())?;
    file.strip_prefix(&root)
        .map(Path::to_path_buf)
        .map_err(|_| "Choose files inside the selected project.".into())
}

pub fn read_text(root: &Path, relative: &Path) -> Result<String, String> {
    let path = resolve(root, relative)?;
    let file = fs::File::open(path).map_err(|_| "Could not read the selected file.".to_owned())?;
    let mut text = String::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| "Choose a UTF-8 text file to preview or attach.".to_owned())?;
    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err("Text previews and attachments support files up to 1 MiB.".into());
    }
    if text.contains('\0') {
        return Err("Choose a text file to preview or attach.".into());
    }
    Ok(text)
}

pub fn prompt(instructions: &str, root: &Path, attachments: &[PathBuf]) -> Result<String, String> {
    let mut prompt = instructions.to_owned();
    for path in attachments {
        let contents = read_text(root, path)?;
        prompt.push_str(&format!(
            "\n\n--- Attached project file: {} ---\n{contents}\n--- End attached file ---",
            relative_name(path)
        ));
        if prompt.len() > 4 * 1024 * 1024 {
            return Err("Attached context exceeds 4 MiB. Remove a file and try again.".into());
        }
    }
    Ok(prompt)
}

pub fn open_file(root: &Path, relative: &Path) -> Result<(), String> {
    read_text(root, relative)?;
    let path = resolve(root, relative)?;
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        open_with_fallback(&windows_editors(), |editor| {
            let mut command = std::process::Command::new(editor);
            if editor
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("Code.exe"))
            {
                command.args(["--reuse-window", "--"]);
            }
            command
                .arg(&path)
                .creation_flags(0x08000000)
                .spawn()
                .map(|_| ())
        })
    };
    #[cfg(not(windows))]
    let result = std::process::Command::new(if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    })
    .arg(path)
    .spawn()
    .map(|_| ());
    result
        .map(|_| ())
        .map_err(|_| "Could not open the file in the text editor.".into())
}

#[cfg(any(windows, test))]
fn open_with_fallback(
    editors: &[PathBuf],
    mut launch: impl FnMut(&Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut error = std::io::Error::new(std::io::ErrorKind::NotFound, "No text editor available");
    for editor in editors {
        match launch(editor) {
            Ok(()) => return Ok(()),
            Err(failed) => error = failed,
        }
    }
    Err(error)
}

#[cfg(windows)]
fn windows_editors() -> Vec<PathBuf> {
    let mut editors = Vec::new();
    for (variable, relative) in [
        ("LOCALAPPDATA", "Programs/Microsoft VS Code/Code.exe"),
        ("ProgramFiles", "Microsoft VS Code/Code.exe"),
        ("ProgramFiles(x86)", "Microsoft VS Code/Code.exe"),
    ] {
        if let Some(base) = std::env::var_os(variable) {
            editors.push(PathBuf::from(base).join(relative));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            editors.push(directory.join("Code.exe"));
            // VS Code's PATH entry normally points to its bin/code.cmd launcher.
            if directory.join("code.cmd").is_file()
                && let Some(parent) = directory.parent()
            {
                editors.push(parent.join("Code.exe"));
            }
        }
    }
    editors.retain(|path| path.is_file());
    editors.dedup();
    editors.push("notepad.exe".into());
    editors
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Created,
    Updated,
    Removed,
}

#[derive(Default)]
pub struct Snapshot {
    files: BTreeMap<PathBuf, (u64, Option<SystemTime>)>,
    pub limited: bool,
    text: BTreeMap<PathBuf, String>,
    text_bytes: usize,
}

pub fn snapshot(root: &Path) -> Snapshot {
    fn walk(root: &Path, relative: &Path, depth: usize, result: &mut Snapshot) {
        if depth > 40 {
            result.limited = true;
            return;
        }
        if fs::read_dir(root.join(relative)).is_err() {
            result.limited = true;
            return;
        }
        for entry in entries(&root.join(relative)) {
            if result.files.len() >= MAX_FILES {
                result.limited = true;
                return;
            }
            let path = relative.join(entry.file_name());
            let Ok(kind) = entry.file_type() else {
                result.limited = true;
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                walk(root, &path, depth + 1, result);
            } else if kind.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.len() <= MAX_TEXT_BYTES
                        && result.text_bytes + metadata.len() as usize <= 8 * 1024 * 1024
                        && let Ok(text) = read_text(root, &path)
                    {
                        result.text_bytes += text.len();
                        result.text.insert(path.clone(), text);
                    }
                    result
                        .files
                        .insert(path, (metadata.len(), metadata.modified().ok()));
                } else {
                    result.limited = true;
                }
            }
        }
    }
    let mut result = Snapshot::default();
    walk(root, Path::new(""), 0, &mut result);
    result
}

pub fn changes(before: &Snapshot, after: &Snapshot) -> BTreeMap<PathBuf, Change> {
    let mut result = BTreeMap::new();
    for (path, stamp) in &after.files {
        match before.files.get(path) {
            None => {
                result.insert(path.clone(), Change::Created);
            }
            Some(previous) if previous != stamp => {
                result.insert(path.clone(), Change::Updated);
            }
            _ => {}
        }
    }
    // A bounded scan cannot establish that an omitted file was removed or newly created.
    if before.limited || after.limited {
        result.retain(|path, _| before.files.contains_key(path));
    } else {
        for path in before
            .files
            .keys()
            .filter(|path| !after.files.contains_key(*path))
        {
            result.insert(path.clone(), Change::Removed);
        }
    }
    result
}

/// Bounded text snapshots describe observed changes; unavailable content stays explicit.
pub fn diff_blocks(before: &Snapshot, after: &Snapshot) -> Vec<(String, i32)> {
    let mut blocks = Vec::new();
    let mut push = |text: String, kind| blocks.push((text, kind));
    for (path, change) in changes(before, after) {
        push(
            format!(
                "{} / {}",
                relative_name(&path),
                match change {
                    Change::Created => "Created",
                    Change::Updated => "Updated",
                    Change::Removed => "Removed",
                }
            ),
            0,
        );
        let old = before.text.get(&path);
        let new = after.text.get(&path);
        if (change != Change::Created && old.is_none())
            || (change != Change::Removed && new.is_none())
        {
            push(
                "Text comparison unavailable (binary, unreadable, or snapshot limit).".into(),
                0,
            );
            continue;
        }
        let old: Vec<_> = old
            .map(String::as_str)
            .unwrap_or("")
            .split_inclusive('\n')
            .collect();
        let new: Vec<_> = new
            .map(String::as_str)
            .unwrap_or("")
            .split_inclusive('\n')
            .collect();
        let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
        let suffix = old[prefix..]
            .iter()
            .rev()
            .zip(new[prefix..].iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        push(
            format!(
                "@@ -{},{} +{},{} @@",
                prefix + 1,
                old.len() - prefix - suffix,
                prefix + 1,
                new.len() - prefix - suffix
            ),
            0,
        );
        for (lines, kind, marker) in [
            (&old[prefix..old.len() - suffix], 6, "-"),
            (&new[prefix..new.len() - suffix], 5, "+"),
        ] {
            let text: String = lines
                .iter()
                .take(400)
                .enumerate()
                .map(|(i, line)| {
                    format!(
                        "{} {:>4}  {}\n",
                        marker,
                        prefix + i + 1,
                        line.trim_end_matches('\n')
                    )
                })
                .collect();
            if !text.is_empty() {
                push(text, kind);
            }
            if lines.last().is_some_and(|line| !line.ends_with('\n')) {
                push("No newline at end of file".into(), 0);
            }
            if lines.len() > 400 {
                push("Additional lines omitted from this preview.".into(), 0);
            }
        }
    }
    blocks
}

pub fn change_summary(changes: &BTreeMap<PathBuf, Change>, limited: bool) -> String {
    let count = |kind| changes.values().filter(|&&value| value == kind).count();
    format!(
        "{} created · {} updated · {} removed{}",
        count(Change::Created),
        count(Change::Updated),
        count(Change::Removed),
        if limited { " · partial scan" } else { "" }
    )
}

fn entries(folder: &Path) -> Vec<fs::DirEntry> {
    let mut entries: Vec<_> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| !SKIP.iter().any(|skip| entry.file_name() == *skip))
        .collect();
    entries.sort_by_key(|entry| {
        (
            !entry.file_type().is_ok_and(|kind| kind.is_dir()),
            entry.file_name().to_ascii_lowercase(),
        )
    });
    entries
}

pub struct FileEntry {
    pub relative: PathBuf,
    pub name: String,
    pub depth: usize,
    pub directory: bool,
    pub expanded: bool,
}

pub struct Explorer {
    pub expanded: HashSet<PathBuf>,
    pub rows: Vec<FileEntry>,
}

impl Default for Explorer {
    fn default() -> Self {
        Self {
            expanded: [PathBuf::from("src"), PathBuf::from("output")]
                .into_iter()
                .collect(),
            rows: Vec::new(),
        }
    }
}

impl Explorer {
    pub fn refresh(&mut self, root: &Path) {
        fn walk(
            root: &Path,
            relative: &Path,
            depth: usize,
            expanded: &HashSet<PathBuf>,
            rows: &mut Vec<FileEntry>,
        ) {
            if depth > 40 || rows.len() >= 3000 {
                return;
            }
            for entry in entries(&root.join(relative)) {
                if rows.len() >= 3000 {
                    break;
                }
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_symlink() {
                    continue;
                }
                let relative = relative.join(entry.file_name());
                let open = kind.is_dir() && expanded.contains(&relative);
                rows.push(FileEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    relative: relative.clone(),
                    depth,
                    directory: kind.is_dir(),
                    expanded: open,
                });
                if open {
                    walk(root, &relative, depth + 1, expanded, rows);
                }
            }
        }
        self.rows.clear();
        walk(root, Path::new(""), 0, &self.expanded, &mut self.rows);
    }

    pub fn reveal(&mut self, path: &Path) {
        let mut parent = path.parent();
        while let Some(path) = parent {
            self.expanded.insert(path.to_path_buf());
            parent = path.parent();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_launch_prefers_code_and_falls_back_only_when_launch_fails() {
        let editors = vec![PathBuf::from("Code.exe"), PathBuf::from("notepad.exe")];
        let mut attempts = Vec::new();
        open_with_fallback(&editors, |editor| {
            attempts.push(editor.to_path_buf());
            if attempts.len() == 1 {
                Err(std::io::ErrorKind::NotFound.into())
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts, editors);
        attempts.clear();
        open_with_fallback(&editors, |editor| {
            attempts.push(editor.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(attempts, [PathBuf::from("Code.exe")]);
        assert!(
            open_with_fallback(&editors, |_| Err(
                std::io::ErrorKind::PermissionDenied.into()
            ))
            .is_err()
        );
    }

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "barracks project {} {}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if self.0.parent() == Some(std::env::temp_dir().as_path())
                && self
                    .0
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("barracks project "))
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn comparisons_keep_real_before_and_after_text_and_report_unavailable_content() {
        let root = Fixture::new();
        fs::write(root.0.join("hello.txt"), "header\nhello world\nfooter\n").unwrap();
        fs::write(root.0.join("removed.txt"), "old").unwrap();
        fs::write(root.0.join("binary.dat"), [0, 1]).unwrap();
        let before = snapshot(&root.0);
        fs::write(root.0.join("hello.txt"), "header\nhello kyle!\nfooter\n").unwrap();
        fs::write(root.0.join("created.txt"), "new").unwrap();
        fs::write(root.0.join("binary.dat"), [0, 1, 2]).unwrap();
        fs::remove_file(root.0.join("removed.txt")).unwrap();
        let after = snapshot(&root.0);
        // Later edits must not alter a completed task's comparison.
        fs::write(root.0.join("hello.txt"), "unrelated later edit").unwrap();
        let blocks = diff_blocks(&before, &after);
        assert!(
            blocks
                .iter()
                .any(|(text, kind)| *kind == 6 && text.contains("hello world"))
        );
        assert!(
            blocks
                .iter()
                .any(|(text, kind)| *kind == 5 && text.contains("hello kyle!"))
        );
        assert!(
            !blocks
                .iter()
                .any(|(text, _)| text.contains("footer") || text.contains("unrelated"))
        );
        assert!(blocks.iter().any(|(text, _)| text == "@@ -2,1 +2,1 @@"));
        assert!(
            blocks
                .iter()
                .any(|(text, kind)| *kind == 5 && text.contains("new"))
        );
        assert!(
            blocks
                .iter()
                .any(|(text, kind)| *kind == 6 && text.contains("old"))
        );
        assert!(
            blocks
                .iter()
                .any(|(text, _)| text.contains("comparison unavailable"))
        );
        assert!(blocks.iter().any(|(text, _)| text.contains("No newline")));
    }

    #[test]
    fn comparison_snapshots_respect_the_total_text_budget() {
        let root = Fixture::new();
        let text = "a".repeat(MAX_TEXT_BYTES as usize);
        for index in 0..10 {
            fs::write(root.0.join(format!("{index}.txt")), &text).unwrap();
        }
        let snapshot = snapshot(&root.0);
        assert_eq!(snapshot.text_bytes, 8 * 1024 * 1024);
        assert_eq!(snapshot.text.len(), 8);
        assert_eq!(
            snapshot.files.len(),
            10,
            "Text limits must preserve file-change tracking"
        );
    }

    #[test]
    fn tracks_real_created_updated_removed_files_and_skips_builds() {
        let root = Fixture::new();
        fs::write(root.0.join("keep.txt"), "before").unwrap();
        fs::write(root.0.join("remove.txt"), "old").unwrap();
        let before = snapshot(&root.0);
        fs::write(root.0.join("keep.txt"), "longer after").unwrap();
        fs::remove_file(root.0.join("remove.txt")).unwrap();
        fs::create_dir(root.0.join("output")).unwrap();
        fs::write(root.0.join("output/plan.md"), "# Plan").unwrap();
        fs::create_dir(root.0.join("target")).unwrap();
        fs::write(root.0.join("target/build.log"), "ignore").unwrap();
        let changes = changes(&before, &snapshot(&root.0));
        assert!(changes.get(Path::new("keep.txt")) == Some(&Change::Updated));
        assert!(changes.get(Path::new("remove.txt")) == Some(&Change::Removed));
        assert!(changes.get(Path::new("output/plan.md")) == Some(&Change::Created));
        assert_eq!(changes.len(), 3);
    }

    #[test]
    fn attachments_read_current_contents_and_remain_inside_the_project() {
        let root = Fixture::new();
        let outside = Fixture::new();
        fs::write(root.0.join("README.md"), "first").unwrap();
        let attachment = PathBuf::from("README.md");
        assert!(
            prompt("Plan it", &root.0, std::slice::from_ref(&attachment))
                .unwrap()
                .contains("first")
        );
        fs::write(root.0.join("README.md"), "updated").unwrap();
        assert!(
            prompt("Plan it", &root.0, &[attachment])
                .unwrap()
                .contains("updated")
        );
        fs::write(outside.0.join("secret.txt"), "outside").unwrap();
        assert!(relative_file(&root.0, &outside.0.join("secret.txt")).is_err());
        assert!(read_text(&root.0, &outside.0.join("secret.txt")).is_err());
    }

    #[test]
    fn explorer_expansion_and_reveal_keep_paths_relative() {
        let root = Fixture::new();
        fs::create_dir_all(root.0.join("docs/nested")).unwrap();
        fs::write(root.0.join("docs/nested/plan.md"), "plan").unwrap();
        let mut explorer = Explorer::default();
        explorer.refresh(&root.0);
        assert_eq!(explorer.rows.len(), 1);
        explorer.reveal(Path::new("docs/nested/plan.md"));
        explorer.refresh(&root.0);
        assert!(
            explorer
                .rows
                .iter()
                .any(|row| row.relative == Path::new("docs/nested/plan.md"))
        );
        assert!(explorer.rows.iter().all(|row| !row.relative.is_absolute()));
    }
}
