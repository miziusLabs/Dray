use std::path::{Path, PathBuf};

pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: PathBuf,
}
pub fn discover(cwd: &Path) -> Vec<Skill> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".dray/skills"));
    }
    let mut ancestors: Vec<_> = cwd.ancestors().collect();
    ancestors.reverse();
    for dir in ancestors {
        roots.push(dir.join(".dray/skills"));
    }
    let mut skills = std::collections::BTreeMap::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path().join("SKILL.md");
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Some((name, description)) = metadata(&contents) else {
                continue;
            };
            skills.insert(
                name.clone(),
                Skill {
                    name,
                    description,
                    path,
                },
            );
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
    Ok(format!(
        "{}\n\nUse the skill at {}:\n{}",
        rest,
        skill.path.display(),
        std::fs::read_to_string(&skill.path)?
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
}
