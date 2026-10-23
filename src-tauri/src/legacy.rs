//! One-time migration of the app data files written by versions before the English code base.
//!
//! Earlier versions kept their files in `app_data_dir` under Turkish names. On start-up (before the language and the
//! menu are set up) each legacy file that is found is renamed to its current name, unless a file with the current
//! name already exists (then the current file wins and the legacy file is left untouched, so nothing is overwritten).
//! The contents need no conversion here: the recent files list reads the legacy field names through serde aliases
//! (`recent.rs`), the projects backup is converted by the web side (`app/js/migrate.js`) and the language file holds
//! only a language code.
//!
//! Crash leftovers of the atomic writer with the legacy temp suffix are removed like current ones
//! (`recent::remove_leftover_temps`).
//!
//! Note: the bundle identifier changed with the rename (`com.onurmert.kitapcilt` → `com.onurmert.mucellit`), so a
//! sandboxed build gets a new container; files in the old container are not reachable from here.

use std::fs;
use std::io;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

// legacy-names: begin (file names and the temp suffix used by earlier versions)
/// (legacy name, current name) of each app data file.
pub const LEGACY_FILES: [(&str, &str); 3] = [
    ("surec.json", crate::backup::FILE_NAME),
    ("son-acilanlar.json", crate::recent::FILE_NAME),
    ("dil.txt", crate::i18n::CHOICE_FILE),
];
/// Suffix of the atomic writer's temp files in earlier versions (now `.temp`).
pub const LEGACY_TEMP_SUFFIX: &str = ".gecici";
// legacy-names: end

/// Renames the legacy files found in `dir`. Returns the legacy names that were moved. A legacy file is skipped when the
/// current file already exists; an error on one file does not stop the others (it is returned at the end).
pub fn migrate_dir(dir: &Path) -> io::Result<Vec<String>> {
    let mut moved = Vec::new();
    let mut first_error = None;
    for (old, new) in LEGACY_FILES {
        let from = dir.join(old);
        let to = dir.join(new);
        if !from.is_file() || to.exists() {
            continue;
        }
        match fs::rename(&from, &to) {
            Ok(()) => moved.push(old.to_string()),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) if moved.is_empty() => Err(e),
        Some(e) => {
            eprintln!("legacy file migration incomplete: {e}");
            Ok(moved)
        }
        None => Ok(moved),
    }
}

/// Start-up hook: migrates the legacy files in this app's data folder (errors are logged; start-up continues).
pub fn migrate_app_data<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    match migrate_dir(&dir) {
        Ok(moved) => {
            for name in moved {
                eprintln!("migrated legacy file {name}");
            }
        }
        Err(e) => eprintln!("legacy file migration failed: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mc-legacy-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn fixture(name: &str) -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../app/test/fixtures/legacy")
                .join(name),
        )
        .unwrap()
    }

    /// Legacy files (real fixtures of the old format) are renamed, their content is kept byte for byte and the recent
    /// files list reads the legacy field names; a second run does nothing.
    #[test]
    fn legacy_files_are_renamed_and_readable() {
        let d = temp_dir();
        let projects = fixture("projects-v1.json");
        let recent = fixture("recent-files-v1.json");
        fs::write(d.join("surec.json"), &projects).unwrap();
        fs::write(d.join("son-acilanlar.json"), &recent).unwrap();
        fs::write(d.join("dil.txt"), "tr\n").unwrap();
        let mut moved = migrate_dir(&d).unwrap();
        moved.sort();
        assert_eq!(moved, ["dil.txt", "son-acilanlar.json", "surec.json"]);
        for (old, _) in LEGACY_FILES {
            assert!(!d.join(old).exists(), "{old} left behind");
        }
        assert_eq!(
            fs::read(d.join(crate::backup::FILE_NAME)).unwrap(),
            projects
        );
        assert_eq!(fs::read(d.join(crate::recent::FILE_NAME)).unwrap(), recent);
        assert_eq!(
            crate::i18n::read_choice(&d.join(crate::i18n::CHOICE_FILE)).as_deref(),
            Some("tr")
        );
        assert!(crate::backup::read(&d.join(crate::backup::FILE_NAME)).is_some());
        let list = crate::recent::RecentList::load(&d.join(crate::recent::FILE_NAME));
        assert_eq!(list.entries.len(), 2, "legacy field names are read");
        assert_eq!(list.entries[0].name, "Mavi Pusula.epub");
        assert_eq!(
            list.entries[0].bookmark.as_deref(),
            Some("Ym9vazAAAAAAAAAA")
        );
        assert!(list.entries[1].bookmark.is_none());
        assert_eq!(
            migrate_dir(&d).unwrap(),
            Vec::<String>::new(),
            "second run does nothing"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// A current file is never overwritten: the legacy file stays where it is (no data is lost).
    #[test]
    fn current_file_wins_and_legacy_file_is_kept() {
        let d = temp_dir();
        fs::write(d.join("surec.json"), "{\"old\":1}").unwrap();
        fs::write(d.join(crate::backup::FILE_NAME), "{\"new\":1}").unwrap();
        assert_eq!(migrate_dir(&d).unwrap(), Vec::<String>::new());
        assert_eq!(
            fs::read_to_string(d.join(crate::backup::FILE_NAME)).unwrap(),
            "{\"new\":1}"
        );
        assert_eq!(
            fs::read_to_string(d.join("surec.json")).unwrap(),
            "{\"old\":1}"
        );
        fs::remove_dir_all(&d).unwrap();
    }

    /// Faulty inputs: an empty or missing folder and a legacy name that is a folder are ignored.
    #[test]
    fn faulty_inputs_are_ignored() {
        let d = temp_dir();
        assert_eq!(
            migrate_dir(&d).unwrap(),
            Vec::<String>::new(),
            "empty folder"
        );
        assert_eq!(
            migrate_dir(&d.join("missing")).unwrap(),
            Vec::<String>::new(),
            "missing folder"
        );
        fs::create_dir(d.join("surec.json")).unwrap();
        assert_eq!(
            migrate_dir(&d).unwrap(),
            Vec::<String>::new(),
            "legacy name is a folder"
        );
        assert!(!d.join(crate::backup::FILE_NAME).exists());
        fs::remove_dir_all(&d).unwrap();
    }

    /// Old temp leftovers (legacy suffix) are removed like current ones; files that only look similar are kept.
    #[test]
    fn legacy_temp_leftovers_are_removed() {
        let d = temp_dir();
        let u = || uuid::Uuid::new_v4().to_string();
        let leftover = d.join(format!(".surec.json.{}{LEGACY_TEMP_SUFFIX}", u()));
        let current = d.join(format!(".projects.json.{}.temp", u()));
        let unrelated = d.join(format!("notes{LEGACY_TEMP_SUFFIX}"));
        for f in [&leftover, &current, &unrelated] {
            fs::write(f, "x").unwrap();
        }
        assert_eq!(
            crate::recent::remove_leftover_temps(&d, std::time::Duration::ZERO),
            2
        );
        assert!(!leftover.exists() && !current.exists() && unrelated.exists());
        fs::remove_dir_all(&d).unwrap();
    }
}
