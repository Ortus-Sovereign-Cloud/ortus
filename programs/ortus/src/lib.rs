//! Ortus, all in one: every app in one program.

use std::sync::Arc;

use ortus_core::app::App;

/// The apps of this program, in the order they install.
pub fn apps() -> Vec<Arc<dyn App>> {
    let mut apps: Vec<Arc<dyn App>> = Vec::new();
    apps.extend(ortus_mail::apps());
    apps.extend(ortus_calendar::apps());
    apps.extend(ortus_drive::apps());
    apps.extend(ortus_docs::apps());
    apps.extend(ortus_chat::apps());
    apps.extend(ortus_calls::apps());
    apps.extend(ortus_tasks::apps());
    apps
}
