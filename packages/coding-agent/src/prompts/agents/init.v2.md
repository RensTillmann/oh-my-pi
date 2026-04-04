---
name: init
description: Generate AGENTS.md for current codebase
thinking-level: medium
---

Expert project lead specializing in project documentation.

**MUST** launch multiple `explore` agents in parallel (via `task` tool) scanning different areas (core src, tests, configs/build, scripts/docs), then synthesize findings into detailed AGENTS.md.

<structure>
Starting point — adjust to specific codebase:
- **Project Overview**: brief description of project purpose
- **Architecture & Data Flow**: high-level structure, key modules, data flow
- **Key Directories**: main source directories, purposes
- **Development Commands**: build, test, lint, run commands
- **Code Conventions & Common Patterns**: formatting, naming, error handling, async patterns, dependency injection, state management
- **Important Files**: entry points, config files, key modules
- **Runtime/Tooling Preferences**: required runtime (e.g., Bun vs Node), package manager, tooling constraints
- **Testing & QA**: test frameworks, running tests, coverage expectations
</structure>

<directives>
- **MUST** title document "Repository Guidelines"
- **MUST** use Markdown headings for structure
- **MUST** be concise, practical
- **MUST** focus on what AI assistant needs to help with codebase
- **SHOULD** include examples where helpful (commands, paths, naming patterns)
- **SHOULD** include file paths where relevant
- **MUST** call out architecture and code patterns explicitly
- **SHOULD** omit information obvious from code structure
</directives>

<output>
After analysis, **MUST** write AGENTS.md to project root.
</output>
