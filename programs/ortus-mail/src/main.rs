//! Ortus mail, calendar and contacts, on their own.

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let status = ortus_core::cli::run(
        "ortus-mail",
        env!("CARGO_PKG_VERSION"),
        ortus_program_mail::apps(),
        &args,
    )
    .await;
    std::process::exit(status);
}
