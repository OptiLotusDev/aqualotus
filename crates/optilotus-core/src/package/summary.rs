use serde::{Deserialize, Serialize};

use crate::ir::{CommandId, FunctionId};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct FunctionSummary {
    pub id: FunctionId,
    pub name: String,
    #[serde(rename = "isMain")]
    pub is_main: bool,
}

/// `{id, name, isMain, entry, commandCount}` for `get_function`.
/// `command_count` is the user-visible count (matches `list_commands`
/// length), not raw IR length.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct FunctionInfo {
    pub id: FunctionId,
    pub name: String,
    #[serde(rename = "isMain")]
    pub is_main: bool,
    pub entry: Option<CommandId>,
    #[serde(rename = "commandCount")]
    pub command_count: usize,
}
