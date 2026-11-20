//! Ortus, all in one: the core and every app in one program.

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let status = ortus_core::cli::run(
        "ortus",
        env!("CARGO_PKG_VERSION"),
        &ortus_core::schemas(),
        &args,
    )
    .await;
    std::process::exit(status);
}
