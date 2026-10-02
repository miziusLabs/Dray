//! Regenerate frontend types directly from Rust without launching the UI.
use ts_rs::TS;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/types");
    let cfg = ts_rs::Config::from_env()
        .with_out_dir(&dir)
        .with_large_int("number");
    let output = dir.join("events.ts");
    if output.exists() {
        std::fs::remove_file(output)?;
    }
    ade_lib::account::AccountStatus::export_all(&cfg)?;
    ade_lib::attachments::Attachment::export_all(&cfg)?;
    ade_lib::events::AgentEvent::export_all(&cfg)?;
    ade_lib::events::AgentEventPayload::export_all(&cfg)?;
    ade_lib::events::Question::export_all(&cfg)?;
    ade_lib::events::QuestionOption::export_all(&cfg)?;
    ade_lib::events::TurnStatus::export_all(&cfg)?;
    ade_lib::events::BlockRef::export_all(&cfg)?;
    ade_lib::events::DeltaEvent::export_all(&cfg)?;
    ade_lib::events::BlockType::export_all(&cfg)?;
    ade_lib::events::ToolType::export_all(&cfg)?;
    ade_lib::events::ToolResult::export_all(&cfg)?;
    ade_lib::events::MessageSender::export_all(&cfg)?;
    ade_lib::events::FileEdit::export_all(&cfg)?;
    ade_lib::events::FileChange::export_all(&cfg)?;
    ade_lib::events::HookPhase::export_all(&cfg)?;
    ade_lib::events::ErrorSource::export_all(&cfg)?;
    ade_lib::events::ImageRef::export_all(&cfg)?;
    ade_lib::events::SessionInfo::export_all(&cfg)?;
    ade_lib::events::McpServer::export_all(&cfg)?;
    ade_lib::events::Settings::export_all(&cfg)?;
    ade_lib::events::usage::Usage::export_all(&cfg)?;
    ade_lib::events::usage::ModelUsage::export_all(&cfg)?;
    ade_lib::events::usage::ContextWindow::export_all(&cfg)?;
    ade_lib::events::usage::RateLimit::export_all(&cfg)?;
    ade_lib::files::FileMatch::export_all(&cfg)?;
    ade_lib::git::BranchList::export_all(&cfg)?;
    ade_lib::git::ChangedFile::export_all(&cfg)?;
    ade_lib::git::ChangeStatus::export_all(&cfg)?;
    ade_lib::git::ChangeSet::export_all(&cfg)?;
    ade_lib::git::FileVersions::export_all(&cfg)?;
    ade_lib::git::Unreadable::export_all(&cfg)?;
    ade_lib::git::Commit::export_all(&cfg)?;
    ade_lib::git::SyncStatus::export_all(&cfg)?;
    ade_lib::git::WorkStatus::export_all(&cfg)?;
    ade_lib::github::CheckState::export_all(&cfg)?;
    ade_lib::github::PrCheck::export_all(&cfg)?;
    ade_lib::github::CommentKind::export_all(&cfg)?;
    ade_lib::github::PrComment::export_all(&cfg)?;
    ade_lib::github::PullRequest::export_all(&cfg)?;
    ade_lib::github::MergeMethod::export_all(&cfg)?;
    ade_lib::github::PrUnavailable::export_all(&cfg)?;
    ade_lib::github::PrMarkState::export_all(&cfg)?;
    ade_lib::github::PrMark::export_all(&cfg)?;
    ade_lib::github::PrChecksState::export_all(&cfg)?;
    ade_lib::harness::Harness::export_all(&cfg)?;
    ade_lib::harness::dray::commands::SlashCommand::export_all(&cfg)?;
    ade_lib::models::Effort::export_all(&cfg)?;
    ade_lib::models::ModelId::export_all(&cfg)?;
    ade_lib::models::AgentModel::export_all(&cfg)?;
    ade_lib::models::Model::export_all(&cfg)?;
    ade_lib::projects::Project::export_all(&cfg)?;
    ade_lib::session::SessionStatusEvent::export_all(&cfg)?;
    ade_lib::session::QueuedMessage::export_all(&cfg)?;
    ade_lib::session::SendOutcome::export_all(&cfg)?;
    ade_lib::store::SessionStatus::export_all(&cfg)?;
    ade_lib::store::SessionIndexItem::export_all(&cfg)?;
    ade_lib::store::SessionSnapshot::export_all(&cfg)?;
    ade_lib::title::SessionTitleEvent::export_all(&cfg)?;
    ade_lib::usage::PlanUsage::export_all(&cfg)?;
    Ok(())
}
