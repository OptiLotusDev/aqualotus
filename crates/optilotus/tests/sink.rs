use optilotus::{PrintSink, VecSink};

#[test]
fn vec_sink_buffers_lines_in_order() {
    let mut sink = VecSink::default();
    sink.print("a");
    sink.print("b\nc");
    assert_eq!(sink.lines, vec!["a".to_string(), "b\nc".to_string()]);
}

#[test]
fn vec_string_sink_pushes_lines() {
    let mut sink: Vec<String> = Vec::new();
    sink.print("hello");
    assert_eq!(sink, vec!["hello".to_string()]);
}
