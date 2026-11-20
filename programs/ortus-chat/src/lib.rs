//! Ortus chat and calls, on their own.

use std::sync::Arc;

use ortus_core::app::App;

/// The apps of this program, in the order they install.
pub fn apps() -> Vec<Arc<dyn App>> {
    let mut apps: Vec<Arc<dyn App>> = Vec::new();
    apps.extend(ortus_chat::apps());
    apps.extend(ortus_calls::apps());
    apps
}
