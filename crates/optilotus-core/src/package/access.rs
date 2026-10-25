use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub enum Access {
    /// Visible to every package (global scope). Currently equivalent to
    /// `Protected`, because only one package can exist.
    Public,
    /// Visible within the declaring package. Currently equivalent to
    /// `Public`; becomes distinct once multiple packages exist.
    Protected,
    /// Visible only inside the declaring scope: the function today, and
    /// the class once classes exist. This is the default, and it matches
    /// the runtime's existing per-call variable scope.
    #[default]
    Private,
}

impl Access {
    /// Parse a wire tag (`"public"` / `"protected"` / `"private"`).
    pub fn parse_tag(tag: &str) -> Option<Self> {
        match tag {
            "public" => Some(Access::Public),
            "protected" => Some(Access::Protected),
            "private" => Some(Access::Private),
            _ => None,
        }
    }

    /// Wire tag for this access level.
    pub fn tag(self) -> &'static str {
        match self {
            Access::Public => "public",
            Access::Protected => "protected",
            Access::Private => "private",
        }
    }
}
