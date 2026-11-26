use std::io::Read as _;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use keysmith_cli::inject::{
    extract_ks_references, render_template, resolve_all_references, resolve_reference_string,
    run_with_secret_env, write_restricted_file,
};
use keysmith_cli::nmh::{install_nmh_manifests, run_nmh, BrowserTarget, DEFAULT_EXTENSION_ID};
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
    /// Read a secret directly by `ks://<vault>/<item>/<field>` reference
    Read {
        reference: String,
        /// Do not print a trailing newline
        #[arg(short = 'n', long)]
        no_newline: bool,
    },
    /// Inject `ks://...` secrets into a template file or stdin
    Inject {
        /// Input template file (defaults to stdin)
        #[arg(short = 'i', long = "in-file")]
        in_file: Option<PathBuf>,
        /// Output file path written with 0600 permissions (defaults to stdout)
        #[arg(short = 'o', long = "out-file")]
        out_file: Option<PathBuf>,
    },
    /// Run a subprocess with `ks://...` environment variables resolved in memory
    Run {
        /// Optional .env file containing `KEY=ks://...` definitions
        #[arg(long = "env-file")]
        env_file: Option<PathBuf>,
        /// Disable automatic secret masking in stdout/stderr
        #[arg(long = "no-masking")]
        no_masking: bool,
        /// Command and arguments to execute (after `--`)
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
        command: Vec<String>,
    },
    /// Run OpenSSH-compatible SSH agent over Unix domain socket
    SshAgent {
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Run Chrome Native Messaging Host stdio bridge
    Nmh,
    /// Install Chrome/Edge/Arc/Brave Native Messaging Host manifest
    InstallNmh {
        #[arg(long)]
        chrome: bool,
        #[arg(long)]
        edge: bool,
        #[arg(long)]
        arc: bool,
        #[arg(long)]
        brave: bool,
        extension_id: Option<String>,
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
        Commands::Read {
            reference,
            no_newline,
        } => {
            let client = SocketClient::from_default_path()?;
            let secret = Zeroizing::new(resolve_reference_string(&client, &reference).await?);
            if cli.json {
                print_json(&json!({ "reference": reference, "value": &*secret }))?;
            } else if no_newline {
                print!("{}", *secret);
            } else {
                println!("{}", *secret);
            }
        }
        Commands::Inject { in_file, out_file } => {
            let template = match &in_file {
                Some(path) => std::fs::read_to_string(path)
                    .with_context(|| format!("Failed to read template file {}", path.display()))?,
                None => {
                    let mut buf = String::new();
                    std::io::stdin()
                        .read_to_string(&mut buf)
                        .context("Failed to read template from stdin")?;
                    buf
                }
            };
            let refs = extract_ks_references(&template);
            let resolved = if refs.is_empty() {
                std::collections::HashMap::new()
            } else {
                let client = SocketClient::from_default_path()?;
                resolve_all_references(&client, &refs).await?
            };
            let rendered = Zeroizing::new(render_template(&template, &resolved)?);
            if let Some(out_path) = out_file {
                write_restricted_file(&out_path, &rendered)?;
            } else {
                print!("{}", *rendered);
            }
        }
        Commands::Run {
            env_file,
            no_masking,
            command,
        } => {
            let client = SocketClient::from_default_path()?;
            let code =
                run_with_secret_env(&client, env_file.as_deref(), no_masking, &command).await?;
            if code != 0 {
                std::process::exit(code);
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
            brave,
            extension_id,
        } => {
            let home = PathBuf::from(
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .context("HOME/USERPROFILE environment variable is not set")?,
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
            if brave {
                targets.push(BrowserTarget::Brave);
            }
            let target_ext_id = extension_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(DEFAULT_EXTENSION_ID);
            let written = install_nmh_manifests(&home, &exe, target_ext_id, &targets)?;
            for path in written {
                println!("Installed Native Messaging manifest: {}", path.display());
            }
        }
    }

    Ok(())
}
