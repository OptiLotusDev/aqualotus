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

/// Explicit effect boundary for `Input`. Core never touches stdin.
///
/// The executor reads here; headless runs and tests inject a buffer of
/// lines.
pub trait InputSource {
    /// Returns the next line (without trailing newline), or `None` on EOF.
    fn read_line(&mut self) -> Option<String>;
}

/// Buffering input source used by tests and headless runs.
#[derive(Debug, Default)]
pub struct VecSource {
    pub lines: Vec<String>,
    pub index: usize,
}

impl InputSource for VecSource {
    fn read_line(&mut self) -> Option<String> {
        if self.index < self.lines.len() {
            let line = self.lines[self.index].clone();
            self.index += 1;
            Some(line)
        } else {
            None
        }
    }
}

impl InputSource for Vec<String> {
    fn read_line(&mut self) -> Option<String> {
        if self.is_empty() {
            None
        } else {
            Some(self.remove(0))
        }
    }
}
