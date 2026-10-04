use optilotus::{health_check, version, VERSION};

#[test]
fn version_is_set() {
    assert_eq!(version(), VERSION);
    assert!(!VERSION.is_empty());
}

#[test]
fn health_is_ok() {
    assert_eq!(health_check(), "ok");
}
