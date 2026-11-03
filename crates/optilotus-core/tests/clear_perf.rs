use optilotus_core::Package;
use std::time::Instant;

#[test]
fn clear_package_stays_fast() {
    let mut pkg = Package::new();
    for _ in 0..30 {
        pkg.clear_package();
    }
    // Undo all 30 clears; should be fast and not O(2^n).
    let start = Instant::now();
    for _ in 0..30 {
        pkg.undo();
    }
    assert!(start.elapsed().as_secs() < 5);
}
