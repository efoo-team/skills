# efoo-team/skills

Shared agent skills for efoo-team.

## Setup

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/efoo-team/skills/main/setup.sh)
```

Or clone and run locally:

```bash
ghq get efoo-team/skills
bash ~/ghq/github.com/efoo-team/skills/setup.sh
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
