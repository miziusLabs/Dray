#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dray_agent::run().await
}
