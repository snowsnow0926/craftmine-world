//! Player creation content history (VM0–VM4).
//!
//! Source content, parentage, branches and version tags are authoritative in a
//! real managed Git repository. SQLite only indexes deployment records, task
//! leases, operation logs and play progress; it never becomes a second source
//! of content history. A world's authoring repository is always separate from
//! the Craftmine product repository.
//!
//! [`contract`] is the single frozen definition of the shared references and
//! the `craftmine.assets-lock/1` canonical form. [`git`] is the only place in
//! this crate that spawns Git. [`repo`] owns repository layout and operations.

pub(crate) mod apply;
pub(crate) mod contract;
pub(crate) mod git;
pub(crate) mod migration;
pub(crate) mod repo;

#[cfg(test)]
#[path = "apply_tests.rs"]
mod apply_tests;
#[cfg(test)]
#[path = "contract_tests.rs"]
mod contract_tests;
#[cfg(test)]
#[path = "contract_vectors_tests.rs"]
mod contract_vectors_tests;
#[cfg(test)]
#[path = "git_tests.rs"]
mod git_tests;
#[cfg(test)]
#[path = "migration_tests.rs"]
mod migration_tests;
#[cfg(test)]
#[path = "repo_tests.rs"]
mod repo_tests;
