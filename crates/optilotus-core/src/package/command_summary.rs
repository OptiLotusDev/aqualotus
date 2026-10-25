use serde::{Deserialize, Serialize};

use crate::ir::{CommandId, ValueId};
use crate::package::access::Access;
use crate::package::kind::CommandKind;
use crate::types::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-bindings", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-bindings", ts(export))]
pub struct CommandSummary {
    pub id: CommandId,
    pub kind: CommandKind,
    pub next: Option<CommandId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub var: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub ty: Option<Type>,
    /// `declare` only: the variable's visibility. Omitted for every other
    /// kind, and for declarations made before access existed (which read
    /// as `private`, the historical behaviour).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub access: Option<Access>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub condition: Option<ValueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub then_body: Option<Vec<CommandId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-bindings", ts(optional))]
    pub else_body: Option<Vec<CommandId>>,
}

impl CommandSummary {
    /// Blank row: identity, kind and linkage only. Builders fill the
    /// per-kind detail fields, so adding a field touches one place.
    pub(crate) fn blank(id: CommandId, kind: CommandKind) -> Self {
        Self {
            id,
            kind,
            next: None,
            var: None,
            ty: None,
            access: None,
            expr: None,
            template: None,
            condition: None,
            then_body: None,
            else_body: None,
        }
    }
}
