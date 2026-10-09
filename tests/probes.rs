#[test]
fn disposable_process_and_capture_experiments() {
    let status = std::process::Command::new("python3")
        .arg("tests/experiments.py")
        .env("VOYAGER_PROBE", env!("CARGO_BIN_EXE_voyager-probe"))
        .status()
        .expect("the Linux experiment suite requires Python 3");
    assert!(status.success(), "fixture experiments failed");
}
