# efoo-team/skills

Shared agent skills for efoo-team.

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

## Structure

```
skills/
  langfuse/              # Langfuse REST API query skill (all agents)
  formation-designer/    # OpenCode formation design guide (opencode only, internal)
```

## Adding a new skill

1. Create a named directory under `skills/`
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`)
3. Optionally add `references/`, `assets/`, `scripts/` subdirectories
