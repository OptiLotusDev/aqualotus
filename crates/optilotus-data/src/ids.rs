//! Stable identities for every stored object.
//!
//! Each id is a thin newtype over a `u32` so ids of different kinds
//! cannot be confused at a call site. Ids are unique within one graph;
//! the allocator that hands them out lives in `optilotus-core`.

use serde::{Deserialize, Serialize};

macro_rules! id_type {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(pub u32);

        impl $name {
            /// First id of this kind. Allocators start at 1 so that 0 can
            /// mean "no id" where a call site needs it.
            pub const FIRST: Self = Self(1);

            /// Raw numeric value.
            pub const fn get(self) -> u32 {
                self.0
            }

            /// The id one past this one.
            pub const fn next_id(self) -> Self {
                Self(self.0 + 1)
            }
        }

        impl From<u32> for $name {
            fn from(value: u32) -> Self {
                Self(value)
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

id_type! {
    /// A function (a named bag of nodes with one entry).
    FunctionId
}

id_type! {
    /// A node in the graph — one unit of storage, one op.
    NodeId
}

id_type! {
    /// A data value produced or consumed by a node.
    ValueId
}

id_type! {
    /// An edge between two nodes.
    EdgeId
}
