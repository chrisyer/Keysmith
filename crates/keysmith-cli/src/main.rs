use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::Value;
use zeroize::Zeroizing;

use keysmith_cli::nmh::{install_nmh_manifests, run_nmh, BrowserTarget};
use keysmith_cli::socket_client::SocketClient;
use keysmith_cli::ssh_agent::run_ssh_agent;

#[derive(Parser)]
#[command(
    name = "ks",
    version,
    about = "Keysmith CLI, OpenSSH agent, and Chrome Native Messaging host"
)]
struct Cli {
    /// Emit raw JSON output instead of formatted text
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check Keysmith desktop daemon and vault lock status
    Status,
    /// List vault items (optionally filtered by search query)
    List {
        #[arg(long)]
        query: Option<String>,
    },
    /// Get an item or specific field by ID or exact/partial title
    Get {
        id_or_title: String,
        #[arg(long)]
        field: Option<String>,
    },
    /// Compute current TOTP code for an item
    Totp { id_or_title: String },
    /// Generate a random password or passphrase
    Generate {
        #[arg(long)]
        length: Option<u32>,
        #[arg(long)]
        passphrase: bool,
    },
    /// Run OpenSSH-compatible SSH agent over Unix domain socket
    SshAgent {
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Run Chrome Native Messaging Host stdio bridge
    Nmh,
    /// Install Chrome/Edge/Arc Native Messaging Host manifest
    InstallNmh {
        #[arg(long)]
        chrome: bool,
        #[arg(long)]
        edge: bool,
        #[arg(long)]
        arc: bool,
        extension_id: String,
    },
}

fn print_json(val: &Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(val)?);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // When Chrome/Edge/Arc launches `ks` via the Native Messaging Host manifest,
    // it passes `chrome-extension://<id>/` as argv[1] instead of `nmh`.
    if let Some(first_arg) = std::env::args().nth(1) {
        if first_arg.starts_with("chrome-extension://") || first_arg.starts_with("moz-extension://")
        {
            return run_nmh().await;
        }
    }

    let cli = Cli::parse();

    match cli.command {
        Commands::Status => {
            let client = SocketClient::from_default_path()?;
            let res = client.status().await?;
            if cli.json {
                print_json(&res)?;
            } else {
                let status = res
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown");
                let email = res.get("email").and_then(|v| v.as_str()).unwrap_or("");
                if email.is_empty() {
                    println!("Status: {status}");
                } else {
                    println!("Status: {status} ({email})");
                }
            }
        }
        Commands::List { query } => {
            let client = SocketClient::from_default_path()?;
            let res = client.list(query.as_deref()).await?;
            if cli.json {
                print_json(&res)?;
            } else if let Some(items) = res.as_array() {
                for item in items {
                    let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("-");
                    let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("-");
                    let category = item.get("category").and_then(|v| v.as_str()).unwrap_or("-");
                    let username = item.get("username").and_then(|v| v.as_str()).unwrap_or("");
                    if username.is_empty() {
                        println!("{id}\t{title}\t[{category}]");
                    } else {
                        println!("{id}\t{title}\t({username})\t[{category}]");
                    }
                }
            } else {
                print_json(&res)?;
            }
        }
        Commands::Get { id_or_title, field } => {
            let client = SocketClient::from_default_path()?;
            let res = client.get(&id_or_title, field.as_deref()).await?;
            if cli.json {
                print_json(&res)?;
            } else if field.is_some() {
                if let Some(val) = res.get("value").and_then(|v| v.as_str()) {
                    let secret = Zeroizing::new(val.to_string());
                    println!("{}", *secret);
                } else if let Some(val) = res.as_str() {
                    let secret = Zeroizing::new(val.to_string());
                    println!("{}", *secret);
                } else {
                    print_json(&res)?;
                }
            } else {
                print_json(&res)?;
            }
        }
        Commands::Totp { id_or_title } => {
            let client = SocketClient::from_default_path()?;
            let res = client.totp(&id_or_title).await?;
            if cli.json {
                print_json(&res)?;
            } else {
                let code = res.get("code").and_then(|v| v.as_str()).unwrap_or("");
                let remaining = res
                    .get("remainingSeconds")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                println!("{code} ({remaining}s remaining)");
            }
        }
        Commands::Generate { length, passphrase } => {
            let client = SocketClient::from_default_path()?;
            let res = client.generate(length, passphrase).await?;
            if cli.json {
                print_json(&res)?;
            } else if let Some(val) = res.get("value").and_then(|v| v.as_str()) {
                let secret = Zeroizing::new(val.to_string());
                println!("{}", *secret);
            } else {
                print_json(&res)?;
            }
        }
        Commands::SshAgent { socket } => {
            run_ssh_agent(socket).await?;
        }
        Commands::Nmh => {
            run_nmh().await?;
        }
        Commands::InstallNmh {
            chrome,
            edge,
            arc,
            extension_id,
        } => {
            let home = PathBuf::from(
                std::env::var_os("HOME").context("HOME environment variable is not set")?,
            );
            let exe = std::env::current_exe()
                .and_then(|p| p.canonicalize())
                .context("Failed to resolve current ks executable path")?;
            let mut targets = Vec::new();
            if chrome {
                targets.push(BrowserTarget::Chrome);
            }
            if edge {
                targets.push(BrowserTarget::Edge);
            }
            if arc {
                targets.push(BrowserTarget::Arc);
            }
            let written = install_nmh_manifests(&home, &exe, &extension_id, &targets)?;
            for path in written {
                println!("Installed Native Messaging manifest: {}", path.display());
            }
        }
    }

    Ok(())
}
