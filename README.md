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
| `jotbird publish` | Read Markdown from stdin |
| `jotbird list` | List your published documents (also visible in the [web app](https://www.jotbird.com/app) as read-only) |
| `jotbird unpublish <file\|slug>` | Take down the public URL (keeps document in account) |
| `jotbird remove <file\|slug>` | Permanently delete a document |
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

Upgrade at [jotbird.com/pro](https://www.jotbird.com/pro).

## Links

- [JotBird](https://www.jotbird.com/)
- [CLI docs](https://www.jotbird.com/cli)
- [API docs](https://www.jotbird.com/docs/api)

## License

MIT
