# efoo-team/skills

Shared agent skills for efoo-team.

## Install

```bash
# Install all skills
npx skills add efoo-team/skills

# Install a specific skill
npx skills add efoo-team/skills --skill langfuse

# Install to all agents
npx skills add efoo-team/skills --agent '*'
```

## Structure

```
skills/
  langfuse/          # Langfuse REST API query skill
```

## Adding a new skill

1. Create a named directory under `skills/`
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`)
3. Optionally add `references/`, `assets/`, `scripts/` subdirectories
