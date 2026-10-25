#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IfSide {
    /// The `then_body` branch of an `if`.
    Then,
    /// The `else_body` branch of an `if`.
    Else,
}

impl IfSide {
    /// Wire spelling of the side (`"then"` / `"else"`), used only for
    /// serialisation / display round-trips.
    pub fn tag(self) -> &'static str {
        match self {
            IfSide::Then => "then",
            IfSide::Else => "else",
        }
    }
}
