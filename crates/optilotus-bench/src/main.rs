use optilotus_core::{CommandSpec, Package, MAIN_ID};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct TrackingAlloc;
static ALLOC_COUNT: AtomicUsize = AtomicUsize::new(0);
static ALLOC_BYTES: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for TrackingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOC_COUNT.fetch_add(1, Ordering::Relaxed);
        ALLOC_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
}

#[global_allocator]
static GLOBAL: TrackingAlloc = TrackingAlloc;

fn reset() {
    ALLOC_COUNT.store(0, Ordering::Relaxed);
    ALLOC_BYTES.store(0, Ordering::Relaxed);
}

fn report(name: &str, us: u128, allocs: usize, bytes: usize) {
    println!("PERF {name}: elapsed={us}us allocs={allocs} bytes={bytes}");
}

fn main() {
    // clear_package
    let mut pkg = Package::new();
    for _ in 0..30 {
        pkg.clear_package();
    }
    reset();
    let t = Instant::now();
    for _ in 0..30 {
        pkg.clear_package();
    }
    report(
        "clear_package x30",
        t.elapsed().as_micros(),
        ALLOC_COUNT.load(Ordering::Relaxed),
        ALLOC_BYTES.load(Ordering::Relaxed),
    );

    // undo/redo
    let mut pkg = Package::new();
    for _ in 0..30 {
        pkg.clear_package();
    }
    reset();
    let t = Instant::now();
    for _ in 0..30 {
        pkg.undo();
    }
    for _ in 0..30 {
        pkg.redo();
    }
    report(
        "undo_redo_clear x30",
        t.elapsed().as_micros(),
        ALLOC_COUNT.load(Ordering::Relaxed),
        ALLOC_BYTES.load(Ordering::Relaxed),
    );

    // nested if
    let mut pkg = Package::new();
    pkg.declare(MAIN_ID, "x", "int32", Some("0")).unwrap();
    reset();
    let t = Instant::now();
    for _ in 0..5 {
        let a = pkg.if_with_expr(MAIN_ID, "{x} < 4", &[], None).unwrap();
        let b = pkg.if_with_expr(MAIN_ID, "{x} < 2", &[], None).unwrap();
        let c = pkg
            .if_with_expr(MAIN_ID, "{x} == 0", &[CommandSpec::print("\"z\"")], None)
            .unwrap();
        pkg.if_append(MAIN_ID, b, optilotus_core::package::IfSide::Then, c)
            .unwrap();
        pkg.if_append(MAIN_ID, a, optilotus_core::package::IfSide::Then, b)
            .unwrap();
    }
    report(
        "nested_if x5",
        t.elapsed().as_micros(),
        ALLOC_COUNT.load(Ordering::Relaxed),
        ALLOC_BYTES.load(Ordering::Relaxed),
    );

    // expr eval
    use std::collections::HashMap;
    let mut vars = HashMap::new();
    vars.insert("x".to_string(), optilotus_core::Value::Int32(10));
    vars.insert("y".to_string(), optilotus_core::Value::Int32(5));
    reset();
    let t = Instant::now();
    for _ in 0..10_000 {
        let _ = optilotus_core::expr::eval_expr("{x} + {y} * {y}", &vars);
    }
    report(
        "expr_eval x10000",
        t.elapsed().as_micros(),
        ALLOC_COUNT.load(Ordering::Relaxed),
        ALLOC_BYTES.load(Ordering::Relaxed),
    );
}
