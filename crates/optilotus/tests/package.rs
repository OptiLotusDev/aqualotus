use optilotus::{
    package_clear, package_create_function, package_delete_function, package_get_function,
    package_list_functions, Package, MAIN_ID,
};

#[test]
fn main_always_exists() {
    let pkg = Package::new();
    let funs = pkg.list_functions();
    assert_eq!(funs.len(), 1);
    assert_eq!(funs[0].id, MAIN_ID);
    assert_eq!(funs[0].name, "main");
    assert!(funs[0].is_main);

    let info = pkg.get_function(MAIN_ID).unwrap();
    assert_eq!(info.name, "main");
    assert!(info.is_main);
    assert!(info.entry.is_none());
    assert_eq!(info.command_count, 0);
}

#[test]
fn cannot_delete_main() {
    let mut pkg = Package::new();
    let err = pkg.delete_function(MAIN_ID).unwrap_err();
    assert_eq!(err.to_string(), "cannot delete entry function \"main\"");
    // main still there
    assert!(pkg.get_function(MAIN_ID).is_ok());
}

#[test]
fn create_list_delete_helper() {
    let mut pkg = Package::new();
    let id = pkg.create_function("helper").unwrap();
    assert_ne!(id, MAIN_ID);

    let funs = pkg.list_functions();
    assert_eq!(funs.len(), 2);
    assert!(funs.iter().any(|f| f.name == "main" && f.is_main));
    assert!(funs.iter().any(|f| f.name == "helper" && !f.is_main));

    let info = pkg.get_function(id).unwrap();
    assert_eq!(info.name, "helper");
    assert!(!info.is_main);

    pkg.delete_function(id).unwrap();
    assert_eq!(pkg.list_functions().len(), 1);
}

#[test]
fn create_rejects_main_and_duplicates() {
    let mut pkg = Package::new();
    assert!(pkg.create_function("main").is_err());
    pkg.create_function("helper").unwrap();
    assert!(pkg.create_function("helper").is_err());
    assert!(pkg.create_function("  helper  ").is_err());
    assert!(pkg.create_function("").is_err());
}

#[test]
fn clear_package_recreates_main() {
    let mut pkg = Package::new();
    pkg.create_function("helper").unwrap();
    assert_eq!(pkg.list_functions().len(), 2);
    pkg.clear_package();
    let funs = pkg.list_functions();
    assert_eq!(funs.len(), 1);
    assert_eq!(funs[0].id, MAIN_ID);
    assert_eq!(funs[0].name, "main");
}

fn bridge_json(s: &str) -> serde_json::Value {
    serde_json::from_str(s).unwrap()
}

#[test]
fn bridge_crud_round_trip() {
    package_clear();
    let list = bridge_json(&package_list_functions());
    assert_eq!(list["status"], "ok");
    assert_eq!(list["functions"].as_array().unwrap().len(), 1);
    assert_eq!(list["functions"][0]["name"], "main");
    assert_eq!(list["functions"][0]["isMain"], true);

    let created = bridge_json(&package_create_function("helper"));
    assert_eq!(created["status"], "ok");
    let id = created["id"].as_u64().unwrap();

    let got = bridge_json(&package_get_function(id as u32));
    assert_eq!(got["status"], "ok");
    assert_eq!(got["name"], "helper");

    // main (0) is protected over the bridge too
    let denied = bridge_json(&package_delete_function(0));
    assert_eq!(denied["status"], "error");
    assert_eq!(denied["kind"], "PackageError");

    let deleted = bridge_json(&package_delete_function(id as u32));
    assert_eq!(deleted["status"], "ok");

    let list = bridge_json(&package_list_functions());
    assert_eq!(list["functions"].as_array().unwrap().len(), 1);
}
