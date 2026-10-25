use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub enum CommandKind {
    Declare,
    Assign,
    Print,
    Input,
    Cast,
    Return,
    If,
    Unknown,
}
