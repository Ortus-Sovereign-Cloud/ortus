//! This program has exactly its apps, and they fit together.

#[test]
fn the_program_has_its_apps() {
    let apps = ortus::apps();
    ortus_core::app::check(&apps).unwrap();
    let mut ids: Vec<&str> = apps.iter().map(|app| app.info().id).collect();
    ids.sort_unstable();
    let mut expected = [
        "mail",
        "calendar",
        "people",
        "drive",
        "docs",
        "chat",
        "calls",
        "tasks",
        "approvals",
        "records",
    ];
    expected.sort_unstable();
    assert_eq!(expected.to_vec(), ids);
}

#[test]
fn the_program_names_itself() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_ortus"))
        .arg("version")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        format!("ortus {}\n", env!("CARGO_PKG_VERSION")),
        String::from_utf8_lossy(&output.stdout)
    );
}
