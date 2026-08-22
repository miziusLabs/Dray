# Releasing Dray

Shipping a release is a version bump, a changelog section, and a tag. CI does
the rest: it builds, signs, notarizes, publishes the release, and writes the
updater manifests. Nothing here needs credentials on your machine — they all
live in GitHub secrets.

## Pick the version

Semver, and the app is `0.x`, so the minor slot carries features:

- **Patch** (`0.3.0` → `0.3.1`) — fixes and polish only.
- **Minor** (`0.3.0` → `0.4.0`) — a new surface or capability.

The **tag's shape picks the channel**, and nothing else does. `v0.4.0` is
stable and writes both manifests; `v0.4.0-beta.1` is beta and writes only
`beta.json`. Because `0.4.0-beta.1` sorts below `0.4.0`, a beta user is offered
the stable build the moment it ships — that falls out of semver, and no code
anywhere reproduces it.

## Bump

Three files, and they must agree. `tauri.conf.json` is the one CI checks
against the tag; `Cargo.toml` drifted unnoticed for three releases because
nothing reads it for the bundle, so bump it in the same breath.

```bash
V=0.4.0
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$V\"/" \
  apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json
sed -i '' "3s/^version = .*/version = \"$V\"/" apps/desktop/src-tauri/Cargo.toml
```

Then `cargo check` once so `Cargo.lock` picks the new version up — a stale lock
is a dirty tree on a tag.

## Write the changelog

Add a `## <version>` section at the top of [CHANGELOG.md](CHANGELOG.md), under
the header. The release job reads that exact section into the GitHub release
notes, and the updater carries it into the app — so it is what the release says
about itself, written in terms of what someone would notice using it, not a
list of commits. GitHub appends the commit list underneath on its own.

**A stable release with no matching section fails the build on purpose.** A
prerelease is allowed to ship without one.

## Check before you tag

From `apps/desktop`:

```bash
pnpm build && pnpm test
cd src-tauri && cargo test
```

`cargo test` regenerates `src/types/events.ts`, so run it bare — a filtered run
rewrites that file with only the types the filtered tests touched and breaks the
frontend build.

## Tag and push

```bash
git add -A && git commit   # chore(release): <version>
git push origin main
git tag v$V && git push origin v$V
```

The tag is the whole trigger. **It must equal `tauri.conf.json`'s version** —
CI fails loudly otherwise, because a mismatched tag publishes a manifest no
client considers newer and the release silently reaches nobody.

Never move a tag that is already on origin. Ship the next patch instead.

## Verify it actually shipped

A green tick is not enough, and one check is the reason why: **the bundler only
*warns* when notarization credentials fail**, so a release that quietly shipped
unnotarized looks exactly like one that worked — until someone's Mac refuses to
open it. The workflow runs `stapler validate` for that, but read it:

```bash
gh run view <id> --log | grep -E 'stapler|source='   # want: accepted, Notarized Developer ID
gh release view v$V --json isPrerelease,assets

curl -s https://monorepo-labs.github.io/dray/stable.json | jq '.version, .platforms|keys'
curl -s https://monorepo-labs.github.io/dray/beta.json   | jq .version
```

Four assets are expected: the DMG (what people download), the
`.app.tar.gz` and its `.sig` (what the updater fetches), and `latest.json`.
Every platform key in a manifest needs a `signature` — without it the client
refuses the download.

A beta release leaves `stable.json` where it was. That is correct, not a
failure.

## Build time, and when it is slow

A warm build is a few minutes; a cold one is about twenty. The difference is
one cache, written by `warm-cache.yml` on `main` — the only scope a tag build
can read from — and both halves of the key live in the two workflow files.

Expect a **cold build** in three cases, all correct:

- The Rust toolchain rolled. Its version is in the cache key, and new compiler
  means the old artifacts genuinely cannot be reused.
- Nothing pushed to `apps/desktop/src-tauri/**` in over a week, so GitHub's LRU
  evicted the entry.
- A dependency changed.

The version bump itself changes `Cargo.lock` and so misses the *exact* key every
release by design; the prefix restore-key is what carries the tree across, since
only `dray` itself moved.

If a build is slow when it should not be, the number to look at is how many
crates recompiled, not the wall clock:

```bash
gh run view <id> --log | grep -c Compiling    # ~2 warm, ~600 cold
```

Two is the floor — `dray` itself, once per architecture.
