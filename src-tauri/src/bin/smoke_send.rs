//! End-to-end smoke test without a UI.
//!
//! Usage:
//!   cargo run --bin smoke_send
//!   cargo run --bin smoke_send -- "Reply with exactly: pong"
//!   cargo run --bin smoke_send -- "hi" haiku low

use ade_lib::claude_code::ClaudeCodeEvent;
use ade_lib::session::{Harness, Session};
use std::time::Duration;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let prompt = args
        .next()
        .unwrap_or_else(|| "Reply with exactly: pong".to_string());
    let model = args.next().unwrap_or_else(|| "haiku".to_string());
    let effort = args.next().unwrap_or_else(|| "low".to_string());

    let session_id = Uuid::now_v7().to_string();
    println!("=== smoke_send ===");
    println!("session_id={session_id}");
    println!("model={model} effort={effort}");
    println!("prompt={prompt:?}");
    println!("==================");

    let mut session = Session::init(
        &session_id,
        Harness::ClaudeCode,
        &model,
        &effort,
        true,
    )
    .await?;

    session.send_msg(&prompt).await?;
    println!("prompt sent; waiting for result event...");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    loop {
        {
            let events = session.events.lock().await;
            if events
                .iter()
                .any(|e| matches!(e, ClaudeCodeEvent::Result(_)))
            {
                println!("\n=== finished: {} parsed events ===", events.len());
                break;
            }
        }

        if tokio::time::Instant::now() > deadline {
            let count = session.events.lock().await.len();
            anyhow::bail!("timed out after 120s waiting for result ({count} events so far)");
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    session.kill().await?;
    Ok(())
}
