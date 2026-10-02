use std::path::{Path, PathBuf};

const BUILTIN_SKILLS: &[&str] = &[
    include_str!("../skills/github/SKILL.md"),
    include_str!("../skills/commit-and-push/SKILL.md"),
];

pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: Option<PathBuf>,
    contents: String,
}

fn parse_skill(contents: &str, path: Option<PathBuf>) -> Option<Skill> {
    let (name, description) = metadata(contents)?;
    Some(Skill {
        name,
        description,
        path,
        contents: contents.into(),
    })
}

fn bundled_skills() -> impl Iterator<Item = Skill> {
    BUILTIN_SKILLS
        .iter()
        .filter_map(|contents| parse_skill(contents, None))
}

pub fn discover(cwd: &Path) -> Vec<Skill> {
    let mut skills = std::collections::BTreeMap::new();
    for skill in bundled_skills() {
        skills.insert(skill.name.clone(), skill);
    }

    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".agents/skills"));
    }
    let mut ancestors: Vec<_> = cwd.ancestors().collect();
    ancestors.reverse();
    for dir in ancestors {
        roots.push(dir.join(".agents/skills"));
    }
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path().join("SKILL.md");
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Some(skill) = parse_skill(&contents, Some(path)) else {
                continue;
            };
            skills.insert(skill.name.clone(), skill);
        }
    }
    skills.into_values().collect()
}

fn metadata(contents: &str) -> Option<(String, String)> {
    let contents = contents
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    let header = contents.strip_prefix("---\n")?.split_once("\n---")?.0;
    let yaml: serde_yaml::Value = serde_yaml::from_str(header).ok()?;
    let name = yaml["name"].as_str()?.to_string();
    let description = yaml["description"].as_str()?.trim().to_string();
    if name.is_empty()
        || name.len() > 64
        || description.is_empty()
        || description.len() > 1024
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return None;
    }
    Some((name, description))
}

pub fn expand(prompt: &str, cwd: &Path) -> anyhow::Result<String> {
    let Some(rest) = prompt
        .strip_prefix("/skill:")
        .or_else(|| prompt.strip_prefix('$'))
    else {
        return Ok(prompt.into());
    };
    let name = rest.split_whitespace().next().unwrap_or_default();
    let skill = discover(cwd)
        .into_iter()
        .find(|skill| skill.name == name)
        .ok_or_else(|| anyhow::anyhow!("Unknown skill {name}"))?;
    let source = skill
        .path
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "the bundled Dray skill".into());
    Ok(format!(
        "{}\n\nUse the skill from {}:\n{}",
        rest, source, skill.contents
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_standard_skill_frontmatter_including_multiline_description() {
        assert_eq!(metadata("---\r\nname: review-code\r\ndescription: >-\r\n  Review changes\r\n  for bugs.\r\n---\r\nInstructions"),Some(("review-code".into(),"Review changes for bugs.".into())));
        assert!(metadata("---\nname: ../escape\ndescription: bad\n---\n").is_none());
        assert!(metadata("# Missing frontmatter").is_none());
    }

    #[test]
    fn discovers_project_skills_from_agents_directory_not_dray() {
        let root = std::env::temp_dir().join(format!("dray-skills-{}", uuid::Uuid::new_v4()));
        let cwd = root.join("nested/project");
        let new_name = format!("new-{}", uuid::Uuid::new_v4());
        let old_name = format!("old-{}", uuid::Uuid::new_v4());
        let new_skill_path = root
            .join(".agents/skills")
            .join(&new_name)
            .join("SKILL.md");
        let old_skill_path = root
            .join(".dray/skills")
            .join(&old_name)
            .join("SKILL.md");

        for (path, name) in [(&new_skill_path, &new_name), (&old_skill_path, &old_name)] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                path,
                format!("---\nname: {name}\ndescription: Test skill.\n---\nInstructions."),
            )
            .unwrap();
        }

        let skills = discover(&cwd);
        let discovered = skills.iter().find(|skill| skill.name == new_name).unwrap();
        assert_eq!(discovered.path.as_deref(), Some(new_skill_path.as_path()));
        assert!(!skills.iter().any(|skill| skill.name == old_name));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovers_bundled_commit_and_push_skill_with_requested_format() {
        let skill = bundled_skills()
            .find(|skill| skill.name == "commit-and-push")
            .expect("the commit-and-push skill is bundled with the agent");
        assert!(skill.path.is_none());
        assert!(skill.contents.contains("non-technical description"));
        assert!(skill.contents.contains("detailed description"));
        assert!(discover(Path::new("."))
            .iter()
            .any(|skill| skill.name == "commit-and-push"));
    }

    #[test]
    fn discovers_bundled_github_skill() {
        let github = bundled_skills()
            .find(|skill| skill.name == "github")
            .expect("the GitHub skill is bundled with the agent");
        assert!(github.path.is_none());
        assert!(github.contents.contains("gh auth status"));
        assert!(github.contents.contains("gh pr view"));
        assert!(discover(Path::new(".")).iter().any(|skill| skill.name == "github"));
    }
}
