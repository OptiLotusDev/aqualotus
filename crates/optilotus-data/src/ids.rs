//! Stable identities for the storage layer.
//!
//! These identify stored graph objects: nodes and edges. They belong to
//! the data layer and know nothing about program meaning.

use serde::{Deserialize, Serialize};

macro_rules! id_type {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(pub u32);

        impl $name {
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
    /// A stored graph node.
    NodeId
}

id_type! {
    /// An edge between two nodes.
    EdgeId
}