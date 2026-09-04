// Vendored-copy replacement for upstream install-lefthook.mjs.
//
// Upstream's postinstall configures Git worktree hooks and a merge driver in
// the repository it lives in. The vendored copy is nested inside the uniterra
// repository: running the upstream script would mutate OUR worktree's Git
// config and hooks (worktree extensions, core.hooksPath, merge driver), so
// the vendored root package.json replaces postinstall with this no-op.
console.log('vendor/dsh-harness: postinstall no-op (upstream lefthook install skipped)')
