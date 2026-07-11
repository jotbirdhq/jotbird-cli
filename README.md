# JotBird

Publish Markdown from the command line. Three commands to go from file to shareable link.

```
$ jotbird publish README.md
Published: https://share.jotbird.com/bright-calm-meadow
```

Every published page gets a responsive URL — no ads, no tracking, no clutter, just your content. Unlike gists, pastebins, and wikis, JotBird links are readable, unlisted, and designed to be shared — not browsed. Noindex by default.

## Install

Requires Node.js 18+.

```bash
npm install -g jotbird
```

## Quick start

```bash
# 1. Log in (one-time setup)
jotbird login

# 2. Publish a file
jotbird publish notes.md

# 3. Update it — same URL, fresh content
jotbird publish notes.md
```

## Commands

| Command | Description |
|---------|-------------|
| `jotbird login` | Authenticate with your JotBird account |
| `jotbird publish <file>` | Publish or update a Markdown file |
| `jotbird publish --slug <slug> <file>` | Update a specific document by slug |
| `jotbird publish --namespace <slug> <file>` | Publish at your username URL (Pro) |
| `jotbird publish --namespace <slug>` | Publish from stdin at your username URL (Pro) |
| `jotbird publish` | Read Markdown from stdin |
| `jotbird list` | List your published documents (also visible in the [web app](https://www.jotbird.com/app) as read-only) |
| `jotbird settings <file\|slug>` | Show a document's page settings |
| `jotbird settings <file\|slug> [flags]` | Update page settings (theme, branding, visibility) |
| `jotbird remove <file\|slug>` | Permanently delete a document |
| `jotbird remove --namespace <slug>` | Permanently delete a namespaced document |
| `jotbird help` | Show help |

## How it works

The CLI tracks file-to-slug mappings in a `.jotbird` file in your working directory. When you publish the same file again, it updates the existing document at the same URL.

```bash
$ jotbird publish README.md
Published: https://share.jotbird.com/bright-calm-meadow

$ jotbird publish README.md
Updated: https://share.jotbird.com/bright-calm-meadow
```

Pipe from stdin for scripts and CI:

```bash
cat notes.md | jotbird publish
echo "# Hello" | jotbird publish
```

When publishing from stdin, no file mapping is created — each publish creates a new document.

To update a specific document by slug — regardless of file tracking — use the `--slug` flag:

```bash
jotbird publish --slug bright-calm-meadow notes.md
echo "# Updated" | jotbird publish --slug bright-calm-meadow
```

## Namespaced URLs (Pro)

Pro users with a username set in Account Settings can publish at permanent, human-readable URLs like `share.jotbird.com/@username/my-page`. Use `--namespace` instead of `--slug`:

```bash
jotbird publish --namespace my-page notes.md
# → https://share.jotbird.com/@username/my-page
```

The `--namespace` flag also works with stdin:

```bash
echo "# Updated" | jotbird publish --namespace my-page
```

The `.jotbird` mapping records the full `@username/slug` path, so subsequent publishes without any flags update the same namespaced URL automatically:

```bash
jotbird publish notes.md
# → Updated: https://share.jotbird.com/@username/my-page
```

Namespaced documents appear as `@username/slug` in `jotbird list` output.

To remove a namespaced document, use the `--namespace` flag or pass the full `@username/slug` form directly:

```bash
jotbird remove --namespace my-page
jotbird remove @username/my-page
```

## Page settings

View or change a published page's theme, branding, and visibility — without republishing:

```bash
# Show current settings
jotbird settings notes.md

# Change the theme (Pro) and make the page search-indexable
jotbird settings notes.md --theme minimal --visibility public

# Password-protect a page (Pro) — prompts for the password
jotbird settings bright-calm-meadow --visibility password

# Hide the JotBird footer branding (Pro)
jotbird settings --namespace my-page --hide-branding
```

Like `remove`, the target can be a tracked file (resolved through `.jotbird`), a slug, or an `@username/slug` path. Flags:

| Flag | Values |
|------|--------|
| `--theme <name>` | `default`, `minimal`, `essay`, `terminal` (non-default themes are Pro) |
| `--hide-branding` / `--show-branding` | Hide or show the JotBird footer branding (hiding is Pro) |
| `--visibility <state>` | `unlisted` (default), `public` (search-indexable), `password` (Pro) |
| `--password <pw>` | Page password, only with `--visibility password`. Omit to be prompted interactively. |

Settings apply to the live page immediately — no republish needed. Free accounts can always clear Pro settings (`--theme default`, `--show-branding`) and switch between `unlisted`/`public`.

### Passwords in scripts

Omitting `--password` prompts for it without echoing, so it stays out of your shell history. For CI, supply it without a prompt — prefer stdin or the environment variable, since an inline `--password <pw>` is visible in your shell history and in `ps` output:

```bash
# Read one line of piped stdin
echo "$PAGE_PASSWORD" | jotbird settings my-page --visibility password --password -

# Or read it from the environment
JOTBIRD_PAGE_PASSWORD="$PAGE_PASSWORD" jotbird settings my-page --visibility password
```

`--password -` requires **piped** stdin. If stdin is a terminal it refuses rather than reading, because the terminal would echo what you type in cleartext — omit `--password` to get the hidden prompt instead.

Sources are consulted in order: `--password`, then `JOTBIRD_PAGE_PASSWORD`, then the interactive prompt. Because a bare `-` is the stdin marker, setting a password that is literally `-` means omitting the flag and typing it at the prompt.

## Authentication

Run `jotbird login` to open your browser and authenticate. The CLI will automatically receive your API key once you sign in — no copy-pasting required. If the browser doesn't open, the CLI displays a URL to visit manually and falls back to a paste prompt.

The key is stored locally at `~/.config/jotbird/credentials` with `0600` permissions.

## Images

Local images referenced in your Markdown are automatically uploaded when you publish. For example, `![photo](./images/photo.png)` will upload `images/photo.png` and replace the local path with the hosted URL in the published version. Your original file is not modified.

Supported formats: PNG, JPEG, GIF, WebP, SVG. Maximum size: 10 MB per image. External URLs (`https://...`) are left unchanged.

## Free vs Pro

| | Free | Pro |
|---|---|---|
| Published links | 90 days expiration | Permanent |
| Active documents | 10 | Unlimited |
| Rate limit | 10 publishes/hour | 100 publishes/hour |
| Namespaced URLs (`@username/slug`) | — | ✓ |

Upgrade at [jotbird.com/pro](https://www.jotbird.com/pro).

## Links

- [JotBird](https://www.jotbird.com/)
- [CLI docs](https://www.jotbird.com/cli)
- [API docs](https://www.jotbird.com/docs/api)

## License

MIT
