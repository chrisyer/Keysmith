use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use keysmith_cli::ssh_agent::run_ssh_agent;

#[derive(Parser)]
#[command(
    name = "keysmith-ssh-agent",
    version,
    about = "OpenSSH-compatible SSH agent backed by Keysmith"
)]
struct Args {
    /// Custom Unix domain socket path for SSH_AUTH_SOCK
    #[arg(long)]
    socket: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    run_ssh_agent(args.socket).await
}
