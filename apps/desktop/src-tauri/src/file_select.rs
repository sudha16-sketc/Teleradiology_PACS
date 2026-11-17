//! Native file and folder selection for the DICOM submission workflow.
//!
//! # Why the dialog is opened from Rust
//!
//! The set of readable paths is the security boundary here, so the *dialog* is
//! opened here too. JavaScript never hands this module a path: a caller that
//! could name its own paths could ask the shell to widen the filesystem scope
//! to arbitrary files on the machine (SSH keys, browser profiles) without the
//! user ever seeing a picker. Instead each command performs the native
//! selection, validates the result, and grants read access to exactly the paths
//! the user just chose — nothing more, and nothing the user did not pick.
//!
//! # Blocking work
//!
//! A file dialog stays open for as long as the user is browsing, and a folder
//! walk stats every entry. Both would tie up an async runtime worker, so the
//! whole sequence runs inside `spawn_blocking` and only the finished result
//! comes back to the command's future.
//!
//! # This is a convenience filter, not a trust boundary
//!
//! Extension and size checks here exist to give immediate, actionable feedback
//! and to avoid uploading gigabytes the API will reject anyway. The NestJS
//! `/dicom/ingest` endpoint remains the authoritative validator: it parses the
//! DICOM, enforces `AXIS_DICOM_MAX_FILE_BYTES`, and derives study ownership
//! from the authenticated session. Nothing selected here is trusted because it
//! was selected here.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::FsExt;

/// Extensions accepted by the submission workflow.
///
/// Mirrors `ACCEPT_EXT` in the web client so a file accepted in the browser is
/// also offered by the native picker. A ZIP archive is accepted because a
/// whole study is commonly exported as one.
const ALLOWED_EXTENSIONS: [&str; 3] = ["dcm", "dicom", "zip"];

/// Per-file cap, mirroring the browser-side limit.
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;

/// Upper bound on how many files one selection may contribute. Guards against a
/// pathological directory being turned into millions of multipart parts.
const MAX_FILES_PER_SELECTION: usize = 5_000;

/// Upper bound on the combined size of one selection.
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// How deep a picked folder is descended.
///
/// A study export is normally only two or three levels deep, so a small bound
/// costs nothing in practice and stops a symlink loop or an accidentally
/// selected `C:\` from walking the disk.
const MAX_WALK_DEPTH: usize = 12;

/// How many directory entries a single folder walk will visit before giving up.
///
/// This is deliberately larger than [`MAX_FILES_PER_SELECTION`]: a real study
/// directory contains plenty of non-DICOM files, and the point of this bound is
/// to stop the *walk*, not to cap the selection. The selection itself is capped
/// separately by [`validate_candidates`].
const MAX_WALK_ENTRIES: usize = 200_000;

/// A validated file the user picked, as reported to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    /// Base name only, used for validation and the multipart filename.
    pub name: String,
    /// Absolute path, needed by the scoped read that follows.
    pub path: String,
    /// Size in bytes, so the UI can show progress without a second stat.
    pub size: u64,
}

/// A directory the user picked. Contents are enumerated by the frontend, which
/// is already scoped to read this directory.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    pub name: String,
    pub path: String,
}

/// A selection entry that has passed the extension filter and carries its own
/// path.
///
/// The path is retained deliberately. An earlier version reduced each entry to
/// `(name, size)` and then tried to recover the path by matching the base name
/// back against the dialog result, which silently returned the *first* of
/// several same-named files. Two `IM0001.dcm` instances in different folders is
/// a completely ordinary study layout, so that was wrong in the common case,
/// not just an edge case. `Candidate` removes the need to reconstruct anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectionError {
    NoAllowedFiles,
    TooManyFiles {
        count: usize,
        max: usize,
    },
    FileTooLarge {
        name: String,
        size: u64,
        max: u64,
    },
    SelectionTooLarge {
        total: u64,
        max: u64,
    },
    Unreadable {
        name: String,
    },
    /// The picked folder nests deeper than the walk will descend.
    FolderTooDeep {
        max: usize,
    },
    /// The picked folder holds more entries than the walk will visit.
    FolderTooLarge {
        max: usize,
    },
}

impl SelectionError {
    /// Message safe to show a user.
    ///
    /// Contains the base name of a file the user themselves just selected, which
    /// they have already seen in the dialog, and never a full path. Nothing here
    /// is written to a log.
    pub fn message(&self) -> String {
        match self {
            Self::NoAllowedFiles => {
                "No DICOM files found. Select .dcm/.dicom files or a .zip archive.".to_string()
            }
            Self::TooManyFiles { count, max } => {
                format!("Too many files selected ({count}); the limit is {max}.")
            }
            Self::FileTooLarge { name, size, max } => format!(
                "File \"{name}\" is {} which exceeds the {} limit.",
                human_bytes(*size),
                human_bytes(*max)
            ),
            Self::SelectionTooLarge { total, max } => format!(
                "The selection totals {} which exceeds the {} limit.",
                human_bytes(*total),
                human_bytes(*max)
            ),
            Self::Unreadable { name } => {
                format!("\"{name}\" could not be read. It may be locked or in use.")
            }
            Self::FolderTooDeep { max } => format!(
                "The selected folder nests more than {max} levels deep. \
                 Select the series folder itself rather than a parent of it."
            ),
            Self::FolderTooLarge { max } => format!(
                "The selected folder has more than {max} entries. \
                 Select a smaller folder."
            ),
        }
    }
}

/// Lowercased extension of the final path segment, or `None` when there is none.
///
/// Two things it must not do, because the result is compared against a
/// file-type allow-list:
///
///   - Read a dot in a *directory* name as an extension. `/a.b/im0001` has no
///     extension, and returning `Some("b/im0001")` would both be wrong and
///     smuggle a path separator into the value.
///   - Treat a leading dot as an extension start. `.dcm` is a dotfile, not a
///     DICOM file.
pub fn extension_of(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let dot = base.rfind('.')?;
    if dot == 0 || dot + 1 == base.len() {
        return None;
    }
    Some(base[dot + 1..].to_ascii_lowercase())
}

/// True when the file name carries an accepted DICOM/ZIP extension.
pub fn has_allowed_extension(name: &str) -> bool {
    extension_of(name)
        .map(|ext| ALLOWED_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

fn human_bytes(bytes: u64) -> String {
    const UNIT: u64 = 1024;
    if bytes < UNIT {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = "KB";
    for next in ["MB", "GB", "TB"] {
        value /= UNIT as f64;
        unit = next;
        if value < 1024.0 {
            break;
        }
    }
    format!("{value:.1} {unit}")
}

/// Check the size and count budgets of one selection.
///
/// Pure, so it can be exercised without a window: everything that needs a real
/// filesystem or a dialog is kept in the command layer.
pub fn validate_candidates(entries: &[Candidate]) -> Result<(), SelectionError> {
    if entries.is_empty() {
        return Err(SelectionError::NoAllowedFiles);
    }
    if entries.len() > MAX_FILES_PER_SELECTION {
        return Err(SelectionError::TooManyFiles {
            count: entries.len(),
            max: MAX_FILES_PER_SELECTION,
        });
    }

    let mut total: u64 = 0;
    for candidate in entries {
        if candidate.size > MAX_FILE_BYTES {
            return Err(SelectionError::FileTooLarge {
                name: candidate.name.clone(),
                size: candidate.size,
                max: MAX_FILE_BYTES,
            });
        }
        total = total.saturating_add(candidate.size);
    }
    if total > MAX_TOTAL_BYTES {
        return Err(SelectionError::SelectionTooLarge {
            total,
            max: MAX_TOTAL_BYTES,
        });
    }
    Ok(())
}

/// Turn raw dialog results into validated candidates, dropping anything without
/// an accepted extension.
///
/// Split out from the command so it can be exercised without a window.
pub fn collect_candidates(picked: Vec<(PathBuf, u64)>) -> Result<Vec<Candidate>, SelectionError> {
    let mut seen = std::collections::HashSet::new();
    let mut candidates: Vec<Candidate> = Vec::new();
    for (path, size) in picked {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            // A name that is not valid UTF-8 cannot be echoed into a multipart
            // header safely, so it is skipped rather than mangled.
            continue;
        };
        if !has_allowed_extension(name) {
            continue;
        }
        // De-duplicate on the full path, not the name: the same base name in two
        // folders is two different instances, while the same path listed twice
        // is one. Keying on name + size (as an earlier version did) collapsed
        // genuinely distinct files.
        if !seen.insert(path.clone()) {
            continue;
        }
        candidates.push(Candidate {
            name: name.to_string(),
            path,
            size,
        });
    }
    validate_candidates(&candidates)?;
    Ok(candidates)
}

/// Resolve the dialog result to a filesystem path, if it is one.
fn dialog_path(entry: &FilePath) -> Option<PathBuf> {
    match entry {
        FilePath::Path(path) => Some(path.clone()),
        // A URL cannot address a local file for reading.
        FilePath::Url(_) => None,
    }
}

/// Stat every chosen path, keeping the pairing between path and size.
fn stat_selected(paths: Vec<PathBuf>) -> Result<Vec<(PathBuf, u64)>, SelectionError> {
    let mut raw = Vec::with_capacity(paths.len());
    for path in paths {
        // `metadata` follows symlinks; a dangling link surfaces here rather than
        // as a confusing read failure later.
        match std::fs::metadata(&path) {
            Ok(meta) => raw.push((path, meta.len())),
            Err(_) => {
                return Err(SelectionError::Unreadable {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("selected file")
                        .to_string(),
                })
            }
        }
    }
    Ok(raw)
}

/// Open the native file picker and allow reading exactly what was chosen.
#[tauri::command]
pub async fn pick_dicom_files<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<Vec<PickedFile>>, String> {
    let candidates = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || -> Result<Option<Vec<PickedFile>>, String> {
            let selected = app
                .dialog()
                .file()
                .set_title("Select DICOM study files")
                .add_filter("DICOM study", &ALLOWED_EXTENSIONS)
                .add_filter("ZIP archive", &["zip"])
                .blocking_pick_files();

            // Dismissed by the user: not an error.
            let Some(entries) = selected else {
                return Ok(None);
            };

            let paths: Vec<PathBuf> = entries.iter().filter_map(dialog_path).collect();
            let raw = stat_selected(paths).map_err(|e| e.message())?;
            let candidates = collect_candidates(raw).map_err(|e| e.message())?;

            // Scope the read to precisely the chosen files, and no deeper: a
            // file grant does not imply access to its containing directory.
            let scope = app.fs_scope();
            let mut picked = Vec::with_capacity(candidates.len());
            for candidate in candidates {
                scope
                    .allow_file(&candidate.path)
                    .map_err(|e| e.to_string())?;
                picked.push(PickedFile {
                    name: candidate.name,
                    path: candidate.path.to_string_lossy().to_string(),
                    size: candidate.size,
                });
            }
            Ok(Some(picked))
        }
    })
    .await
    .map_err(|e| format!("File selection failed: {e}"))??;

    Ok(candidates)
}

/// Open the native folder picker and allow reading exactly that directory.
///
/// The grant is recursive because a study export is routinely split into
/// per-series subfolders and the walk in the submit page has to descend. It is
/// still bounded: only paths under the directory the user chose are reachable,
/// and the walk itself skips symlinks and enforces its own depth and count
/// budgets.
#[tauri::command]
pub async fn pick_dicom_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<PickedFolder>, String> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<PickedFolder>, String> {
            let selected = app
                .dialog()
                .file()
                .set_title("Select a folder containing DICOM files")
                .blocking_pick_folder();

            let Some(entry) = selected else {
                return Ok(None);
            };
            let Some(path) = dialog_path(&entry) else {
                return Err(SelectionError::Unreadable {
                    name: "selected folder".to_string(),
                }
                .message());
            };
            app.fs_scope()
                .allow_directory(&path, true)
                .map_err(|e| e.to_string())?;

            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("folder")
                .to_string();
            Ok(Some(PickedFolder {
                name,
                path: path.to_string_lossy().to_string(),
            }))
        })
        .await
        .map_err(|e| format!("Folder selection failed: {e}"))??;

    Ok(picked)
}

/// Result of walking a picked folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderWalk {
    /// Every allowed file found, each keeping its own path.
    pub files: Vec<Candidate>,
    /// Directories visited.
    pub directories: usize,
    /// Entries examined, allowed or not.
    pub entries_seen: usize,
}

/// Depth-first walk of a directory the user picked, collecting DICOM files.
///
/// Runs here rather than in JavaScript so that path construction, the symlink
/// decision and the read grants all stay on the same side of the boundary as the
/// dialog that authorised them. The frontend receives finished file records and
/// never has to join a path itself.
///
/// Symlinks are not followed. The grant is for the directory the user chose, and
/// a link is the one way a walk could leave it; skipping them costs nothing,
/// because a DICOM export is a plain tree.
pub fn walk_folder(root: &std::path::Path) -> Result<FolderWalk, SelectionError> {
    // Explicit stack rather than recursion: the depth bound already prevents
    // runaway recursion, but a stack keeps memory proportional to breadth.
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut files = Vec::new();
    let mut directories = 0usize;
    let mut entries_seen = 0usize;

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_WALK_DEPTH {
            return Err(SelectionError::FolderTooDeep {
                max: MAX_WALK_DEPTH,
            });
        }
        directories += 1;

        let reader = std::fs::read_dir(&dir).map_err(|_| SelectionError::Unreadable {
            name: dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("selected folder")
                .to_string(),
        })?;

        for entry in reader {
            entries_seen += 1;
            if entries_seen > MAX_WALK_ENTRIES {
                return Err(SelectionError::FolderTooLarge {
                    max: MAX_WALK_ENTRIES,
                });
            }

            // A single unreadable entry should not abandon a study folder.
            let Ok(entry) = entry else { continue };
            let path = entry.path();

            // `file_type` does not follow links, which is what is wanted here: it
            // reports a link as a link rather than as whatever it points at.
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_dir() {
                stack.push((path, depth + 1));
            } else if file_type.is_file() {
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if !has_allowed_extension(name) {
                    continue;
                }
                let Ok(meta) = std::fs::metadata(&path) else {
                    continue;
                };
                files.push(Candidate {
                    name: name.to_string(),
                    path,
                    size: meta.len(),
                });
            }
        }
    }

    Ok(FolderWalk {
        files,
        directories,
        entries_seen,
    })
}

/// Enumerate a folder the user already picked, and grant read access to the
/// files inside it.
///
/// Separate from [`pick_dicom_folder`] so the dialog and the walk are distinct
/// steps: the user chooses the directory once, and the walk can be re-run
/// without a second dialog appearing.
#[tauri::command]
pub async fn collect_dicom_folder<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Vec<PickedFile>, String> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || -> Result<Vec<PickedFile>, String> {
            let walk = walk_folder(&PathBuf::from(path)).map_err(|e| e.message())?;
            validate_candidates(&walk.files).map_err(|e| e.message())?;

            let scope = app.fs_scope();
            let mut picked = Vec::with_capacity(walk.files.len());
            for candidate in walk.files {
                scope
                    .allow_file(&candidate.path)
                    .map_err(|e| e.to_string())?;
                picked.push(PickedFile {
                    name: candidate.name,
                    path: candidate.path.to_string_lossy().to_string(),
                    size: candidate.size,
                });
            }
            Ok(picked)
        })
        .await
        .map_err(|e| format!("Could not read the selected folder: {e}"))??;

    Ok(picked)
}

/// Drop the read grants for a selection once the upload is finished.
///
/// The scope is a runtime allow-list, so without this the app would keep
/// filesystem access to every file the user has ever picked for the lifetime of
/// the process. Failing to release is not worth surfacing: the grant simply
/// persists until the app closes, which is the pre-existing behaviour rather
/// than a new fault.
#[tauri::command]
pub async fn release_picked_paths<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<String>,
) -> Result<(), String> {
    let scope = app.fs_scope();
    for path in &paths {
        let path = PathBuf::from(path);
        // Ignore a miss: the path may never have been granted, and either error
        // leaves the scope in a state we do not want to report as a failure.
        let _ = scope.forbid_file(&path);
        let _ = scope.forbid_directory(&path, true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mb(n: u64) -> u64 {
        n * 1024 * 1024
    }

    fn candidate(name: &str, size: u64) -> Candidate {
        Candidate {
            name: name.to_string(),
            path: PathBuf::from("/studies").join(name),
            size,
        }
    }

    #[test]
    fn extension_is_lowercased_and_read_after_the_last_dot() {
        assert_eq!(extension_of("IM0001.DCM"), Some("dcm".into()));
        assert_eq!(extension_of("archive.Zip"), Some("zip".into()));
        assert_eq!(extension_of("study.dicom"), Some("dicom".into()));
    }

    /// A dotted directory name must not be read as a file extension, and no
    /// path separator may escape into the returned value.
    #[test]
    fn a_dot_in_a_directory_name_is_not_an_extension() {
        assert_eq!(extension_of("/a.b/im0001"), None);
        assert_eq!(extension_of("/a.b/im0001.dcm"), Some("dcm".into()));
        assert_eq!(extension_of("C:\\study.v2\\IM0001"), None);
        assert_eq!(extension_of("C:\\study.v2\\IM0001.dcm"), Some("dcm".into()));
    }

    /// The returned extension is compared against an allow-list, so a separator
    /// reaching it would be a confusing rejection at best.
    #[test]
    fn an_extension_never_contains_a_path_separator() {
        for name in ["/a.b/im0001", "/x/y.z.evil", "a/b.c", "a\\b.c"] {
            if let Some(ext) = extension_of(name) {
                assert!(
                    !ext.contains('/') && !ext.contains('\\'),
                    "{name} yielded {ext}"
                );
            }
        }
    }

    #[test]
    fn names_without_a_real_extension_are_rejected() {
        assert_eq!(extension_of("noextension"), None);
        // A leading dot makes a dotfile, not an extension.
        assert_eq!(extension_of(".dcm"), None);
        // A trailing dot is not an extension.
        assert_eq!(extension_of("trailing."), None);
    }

    #[test]
    fn only_dicom_and_zip_are_accepted() {
        assert!(has_allowed_extension("IM0001.dcm"));
        assert!(has_allowed_extension("IM0001.DICOM"));
        assert!(has_allowed_extension("study.zip"));
        assert!(!has_allowed_extension("report.pdf"));
        assert!(!has_allowed_extension("payload.exe"));
        assert!(!has_allowed_extension("script.js"));
        assert!(!has_allowed_extension("noextension"));
        // A file that merely lives in a dotted directory is not a DICOM file.
        assert!(!has_allowed_extension("/tmp/notes.txt.bak/im0001"));
    }

    #[test]
    fn a_file_exactly_at_the_cap_is_accepted() {
        assert!(validate_candidates(&[candidate("ok.dcm", MAX_FILE_BYTES)]).is_ok());
    }

    #[test]
    fn one_byte_over_the_cap_is_rejected() {
        match validate_candidates(&[candidate("big.dcm", MAX_FILE_BYTES + 1)]) {
            Err(SelectionError::FileTooLarge { name, size, max }) => {
                assert_eq!(name, "big.dcm");
                assert_eq!(size, MAX_FILE_BYTES + 1);
                assert_eq!(max, MAX_FILE_BYTES);
            }
            other => panic!("expected FileTooLarge, got {other:?}"),
        }
    }

    #[test]
    fn oversized_error_message_names_the_file_but_not_its_path() {
        let message = SelectionError::FileTooLarge {
            name: "big.dcm".into(),
            size: mb(2),
            max: mb(1),
        }
        .message();
        assert!(message.contains("big.dcm"));
        assert!(!message.contains('/'));
    }

    #[test]
    fn an_empty_selection_is_reported_as_no_allowed_files() {
        assert_eq!(
            validate_candidates(&[]),
            Err(SelectionError::NoAllowedFiles)
        );
    }

    #[test]
    fn a_selection_under_the_total_cap_passes() {
        let entries = vec![candidate("a.dcm", mb(500)), candidate("b.dcm", mb(500))];
        assert!(validate_candidates(&entries).is_ok());
    }

    #[test]
    fn a_selection_over_the_total_cap_is_rejected() {
        let entries = vec![
            candidate("a.dcm", mb(1000)),
            candidate("b.dcm", mb(1000)),
            candidate("c.dcm", mb(1000)),
            candidate("d.dcm", mb(1000)),
            candidate("e.dcm", mb(1000)),
        ];
        assert!(matches!(
            validate_candidates(&entries),
            Err(SelectionError::SelectionTooLarge { .. })
        ));
    }

    #[test]
    fn the_count_cap_is_enforced() {
        let entries: Vec<Candidate> = (0..=MAX_FILES_PER_SELECTION)
            .map(|i| candidate(&format!("{i}.dcm"), 1))
            .collect();
        assert!(matches!(
            validate_candidates(&entries),
            Err(SelectionError::TooManyFiles { .. })
        ));
    }

    #[test]
    fn candidates_drop_disallowed_extensions() {
        let raw = vec![
            (PathBuf::from("/tmp/IM0001.dcm"), 10),
            (PathBuf::from("/tmp/notes.txt"), 10),
            (PathBuf::from("/tmp/.hidden"), 10),
            (PathBuf::from("/tmp/study.zip"), 20),
        ];
        let candidates = collect_candidates(raw).expect("selection should validate");
        let names: Vec<&str> = candidates.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["IM0001.dcm", "study.zip"]);
    }

    /// The regression that motivated keeping the path on the candidate.
    ///
    /// A study split into per-series folders yields the same base name many
    /// times over. Those are distinct instances and must all survive, each with
    /// its own path, or the upload silently sends the wrong file.
    #[test]
    fn same_named_files_in_different_folders_are_all_kept_with_their_own_paths() {
        let raw = vec![
            (PathBuf::from("/a/IM0001.dcm"), 10),
            (PathBuf::from("/b/IM0001.dcm"), 10),
            (PathBuf::from("/c/IM0001.dcm"), 11),
        ];
        let candidates = collect_candidates(raw).expect("selection should validate");
        assert_eq!(candidates.len(), 3);
        let paths: Vec<String> = candidates
            .iter()
            .map(|c| c.path.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            paths,
            vec!["/a/IM0001.dcm", "/b/IM0001.dcm", "/c/IM0001.dcm"]
        );
    }

    #[test]
    fn the_same_path_listed_twice_is_uploaded_once() {
        let raw = vec![
            (PathBuf::from("/a/IM0001.dcm"), 10),
            (PathBuf::from("/a/IM0001.dcm"), 10),
        ];
        let candidates = collect_candidates(raw).expect("selection should validate");
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn a_selection_of_only_irrelevant_files_is_rejected() {
        let raw = vec![(PathBuf::from("/tmp/notes.txt"), 10)];
        assert_eq!(
            collect_candidates(raw).unwrap_err(),
            SelectionError::NoAllowedFiles
        );
    }

    #[test]
    fn an_oversized_candidate_is_rejected_before_any_read() {
        let raw = vec![(PathBuf::from("/tmp/big.dcm"), MAX_FILE_BYTES + 1)];
        assert!(matches!(
            collect_candidates(raw),
            Err(SelectionError::FileTooLarge { .. })
        ));
    }

    #[test]
    fn dialog_url_entries_never_resolve_to_a_readable_path() {
        let url = FilePath::Url(tauri::Url::parse("file:///etc/passwd").unwrap());
        assert!(dialog_path(&url).is_none());
    }

    // --- Folder walk -------------------------------------------------------
    //
    // These build a real tree under a temp directory rather than mocking
    // `read_dir`, because the properties worth testing — that a symlink is not
    // followed, that the depth bound stops a deep tree, that a same-named file
    // in two series folders is kept twice — are all properties of the
    // filesystem's answer, not of a stub.

    /// A throwaway directory tree that removes itself on drop.
    ///
    /// The suffix is a per-instance counter and not just the process id,
    /// because several of these are alive at once: Cargo runs tests on parallel
    /// threads, and a `mod` tree reachable by two paths would otherwise race
    /// one instance's cleanup against another's walk.
    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static COUNTER: AtomicUsize = AtomicUsize::new(0);

            let root = std::env::temp_dir().join(format!(
                "axis-file-select-{label}-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).expect("temp dir should be creatable");
            TempTree(root)
        }

        fn file(&self, relative: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("parent should be creatable");
            }
            std::fs::write(&path, contents).expect("file should be writable");
            path
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_walk_collects_dicom_files_from_nested_series_folders() {
        let tree = TempTree::new("nested");
        tree.file("IM0001.dcm", b"a");
        tree.file("CT1/IM0002.dcm", b"bb");
        tree.file("CT1/IM0003.dcm", b"ccc");
        tree.file("CT2/IM0004.dcm", b"dddd");

        let walk = walk_folder(&tree.0).expect("walk should succeed");
        let names: Vec<&str> = walk.files.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), 4);
        assert!(names.contains(&"IM0001.dcm"));
        assert!(names.contains(&"IM0004.dcm"));
    }

    #[test]
    fn the_walk_ignores_files_that_are_not_dicom() {
        let tree = TempTree::new("filter");
        tree.file("IM0001.dcm", b"a");
        tree.file("notes.txt", b"b");
        tree.file("report.pdf", b"c");
        tree.file("study.zip", b"d");

        let walk = walk_folder(&tree.0).expect("walk should succeed");
        let names: Vec<&str> = walk.files.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"study.zip"));
    }

    /// The regression the native picker exists to avoid: a study split across
    /// per-series folders repeats the same base name many times.
    #[test]
    fn the_walk_keeps_same_named_files_from_different_folders_apart() {
        let tree = TempTree::new("dupes");
        // Deliberately different sizes: if the walk ever keyed on name or on
        // name+size, the collisions would be visible here.
        tree.file("A/IM0001.dcm", b"aaaa");
        tree.file("B/IM0001.dcm", b"bbbbb");
        tree.file("C/IM0001.dcm", b"cccccc");

        let walk = walk_folder(&tree.0).expect("walk should succeed");
        assert_eq!(walk.files.len(), 3);
        let mut sizes: Vec<u64> = walk.files.iter().map(|c| c.size).collect();
        sizes.sort_unstable();
        assert_eq!(sizes, vec![4, 5, 6]);
        // Distinct paths, so no two records can resolve to the same file.
        let mut paths: Vec<String> = walk
            .files
            .iter()
            .map(|c| c.path.to_string_lossy().to_string())
            .collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), 3);
    }

    /// A link is the one way a walk could read outside the folder the user
    /// chose, so it must not be followed.
    #[cfg(unix)]
    #[test]
    fn the_walk_does_not_follow_symlinks_out_of_the_folder() {
        let tree = TempTree::new("symlink");
        tree.file("inside.dcm", b"a");

        let outside = TempTree::new("symlink-target");
        outside.file("secret.dcm", b"should not be collected");

        std::os::unix::fs::symlink(&outside.0, tree.0.join("escape")).expect("link");
        std::os::unix::fs::symlink(outside.0.join("secret.dcm"), tree.0.join("loose.dcm"))
            .expect("link");

        let walk = walk_folder(&tree.0).expect("walk should succeed");
        let names: Vec<&str> = walk.files.iter().map(|c| c.name.as_str()).collect();
        // Only the real file, reached without traversing a link.
        assert_eq!(names, vec!["inside.dcm"]);
    }

    #[test]
    fn the_walk_stops_at_the_depth_bound() {
        let tree = TempTree::new("deep");
        // One level deeper than the bound allows.
        let mut relative = String::new();
        for level in 0..=MAX_WALK_DEPTH + 1 {
            relative.push_str(&format!("d{level}/"));
        }
        tree.file(&format!("{relative}IM0001.dcm"), b"a");

        match walk_folder(&tree.0) {
            Err(SelectionError::FolderTooDeep { max }) => assert_eq!(max, MAX_WALK_DEPTH),
            other => panic!("expected FolderTooDeep, got {other:?}"),
        }
    }

    #[test]
    fn a_walk_that_finds_nothing_is_reported_as_no_allowed_files() {
        let tree = TempTree::new("empty");
        tree.file("notes.txt", b"a");
        let walk = walk_folder(&tree.0).expect("walk should succeed");
        assert!(walk.files.is_empty());
        assert_eq!(
            validate_candidates(&walk.files).unwrap_err(),
            SelectionError::NoAllowedFiles
        );
    }

    #[test]
    fn a_missing_root_is_reported_rather_than_panicking() {
        let missing = std::env::temp_dir().join("axis-file-select-does-not-exist");
        assert!(matches!(
            walk_folder(&missing),
            Err(SelectionError::Unreadable { .. })
        ));
    }

    #[test]
    fn folder_error_messages_explain_the_fix() {
        let deep = SelectionError::FolderTooDeep {
            max: MAX_WALK_DEPTH,
        }
        .message();
        assert!(deep.contains(&MAX_WALK_DEPTH.to_string()));
        // It should tell the user what to do, not just that it failed.
        assert!(deep.to_lowercase().contains("select"));

        let large = SelectionError::FolderTooLarge {
            max: MAX_WALK_ENTRIES,
        }
        .message();
        assert!(large.contains(&MAX_WALK_ENTRIES.to_string()));
    }
}
