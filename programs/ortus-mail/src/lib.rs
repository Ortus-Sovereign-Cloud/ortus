//! Ortus mail, calendar and contacts, on their own.

use std::sync::Arc;

use ortus_core::app::App;

/// The apps of this program, in the order they install.
pub fn apps() -> Vec<Arc<dyn App>> {
    let mut apps: Vec<Arc<dyn App>> = Vec::new();
    apps.extend(ortus_mail::apps());
    apps.extend(ortus_calendar::apps());
    apps
}
