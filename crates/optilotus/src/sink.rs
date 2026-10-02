/// Explicit effect boundary for `Print`. Core never touches stdout.
///
/// The executor writes here; headless runs and tests inject a buffer.
pub trait PrintSink {
    fn print(&mut self, text: &str);
}

/// Buffering sink used by tests and headless runs.
#[derive(Debug, Default)]
pub struct VecSink {
    pub lines: Vec<String>,
}

impl PrintSink for VecSink {
    fn print(&mut self, text: &str) {
        self.lines.push(text.to_string());
    }
}

impl PrintSink for Vec<String> {
    fn print(&mut self, text: &str) {
        self.push(text.to_string());
    }
}
