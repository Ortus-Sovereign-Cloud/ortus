//! Ortus mail, calendar and contacts, on their own.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Every request is served on the blocking pool, and each open live
    // stream (a chat window, a document) holds one of its threads while it
    // lasts: room for thousands of them, not tokio's 512.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(4096)
        .build()
        .expect("could not start the runtime");
    let status = runtime.block_on(ortus_core::cli::run(
        "ortus-mail",
        env!("CARGO_PKG_VERSION"),
        ortus_program_mail::apps(),
        &args,
    ));
    std::process::exit(status);
}
