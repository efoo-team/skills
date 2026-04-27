# efoo-team/skills

Shared agent skills for efoo-team.

`setup.sh` installs the recommended skills and then removes any names listed in `remove-skills.txt`.

## Setup

```bash
# Clone and run
ghq get efoo-team/skills
bash ~/ghq/github.com/efoo-team/skills/setup.sh
```

Or without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/efoo-team/skills/main/setup.sh | bash
```

When running without cloning, `setup.sh` also fetches `remove-skills.txt` from GitHub so the removal list is still applied.

## Structure

```
remove-skills.txt         # Skill names that setup.sh treats as removal targets
skills/
  database-design/      # Database table and column naming skill (all agents)
  langfuse/              # Langfuse REST API query skill (all agents)
  module-boundary-design/ # Module boundary and responsibility design skill (all agents)
  github-pull-request/  # GitHub pull request authoring skill (all agents)
  refactor-mindset/      # Refactoring judgment skill (all agents)
  formation-designer/    # OpenCode formation design guide (opencode only, internal)
```

## Adding a new skill

1. Create a named directory under `skills/`
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata.tags`)
3. Optionally add `references/`, `assets/`, `scripts/` subdirectories

## Removing a skill

- Add the skill name to `remove-skills.txt` when setup should treat it as a removal target in member environments
- Keep `setup.sh` and `remove-skills.txt` in sync when changing removal policy
