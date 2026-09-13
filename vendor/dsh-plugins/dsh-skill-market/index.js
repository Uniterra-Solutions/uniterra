/**
 * dsh-skill-market — host half.
 *
 * In the settings page the browser half (client.js) renders the Skill Market
 * UI; all GitHub access and file-system work happens here through a same-origin
 * JSON API mounted on the host webServer:
 *
 *   GET  /skill-market/api/search?q=<query>   → GitHub repo search (skill repos)
 *   GET  /skill-market/api/repo?owner=&repo=  → inspect one repo (default branch, SKILL.md layout)
 *   POST /skill-market/api/install            → { owner, repo, ref? } download+extract+install
 *   GET  /skill-market/api/installed          → list installed skills
 *   POST /skill-market/api/uninstall          → { name } move to .trash-*
 *
 * Skills are installed as directory bundles (<name>/SKILL.md) or flat
 * (<name>.md) under the configured installDir (default ~/.dsh/skills — the
 * `user-dsh` root of the local skill provider, rank 400).
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Schema from 'schemastery'

export const name = 'dsh-skill-market'
export const inject = ['webServer']

/**
 * Resolve the directory installed skills land in — the dsh USER SKILL ROOT the
 * model's `skill` tool reads.
 *
 * LOCAL PATCH (uniterra): upstream defaulted `installDir` to the author's own
 * environment and `apply()` fell back to `homedir()` without regard for
 * `DSH_HOME`. Precedence: an EXPLICIT configuration wins; otherwise the live
 * `DSH_HOME` (a relocated or throwaway home must be honoured); otherwise
 * `<home>/.dsh/skills`. The result is always an absolute path.
 */
export function resolveSkillRoot(options = {}) {
  const explicit = typeof options?.explicit === 'string' ? options.explicit.trim() : ''
  if (explicit) return resolve(explicit)
  const dshHome = options?.dshHome ?? process.env.DSH_HOME ?? ''
  if (typeof dshHome === 'string' && dshHome.trim()) return resolve(dshHome, 'skills')
  const home = options?.home ?? homedir()
  return resolve(home, '.dsh', 'skills')
}

export const Config = Schema.object({
  /** Directory where installed skills land. Defaults to <DSH_HOME>/skills. */
  installDir: Schema.string().default(resolveSkillRoot()),
  /** Optional GitHub token to lift search rate limits (10 req/min anonymous). */
  githubToken: Schema.string().default(''),
  /** Optional path to a file containing a GitHub token. */
  githubTokenFile: Schema.string().default(''),
  /** Max search results per query. */
  searchLimit: Schema.number().default(20),
})

const GH_API = 'https://api.github.com'
const CODELOAD = 'https://codeload.github.com'
const USER_AGENT = 'dsh-skill-market/0.1.0'

/* ---------------- tiny helpers ---------------- */

function sendJson(res, code, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': data.length,
  })
  res.end(data)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

/** Same-origin guard for mutating endpoints (mirrors the deployed market plugins). */
function sameOrigin(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

/** Kebab-case skill name: `^[a-z0-9]+(?:-[a-z0-9]+)*$`. */
function skillName(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'skill'
}

function readDescription(mdPath) {
  try {
    const head = readFileSync(mdPath, 'utf8').slice(0, 4000)
    const m = head.match(/^description:\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '').slice(0, 300)
  } catch {}
  return ''
}

/* ---------------- GitHub ---------------- */

let _token = ''
function setToken(value) { _token = String(value || '') }

function ghHeaders() {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' }
  if (_token) headers.Authorization = `Bearer ${_token}`
  return headers
}

async function ghJson(url, signal) {
  const res = await fetch(url, { headers: ghHeaders(), signal })
  if (res.status === 403 || res.status === 429) {
    const msg = await res.text().catch(() => '')
    const rateLimited = /rate limit/i.test(msg)
    throw Object.assign(new Error(
      rateLimited
        ? 'GitHub API 限流：匿名搜索约 10 次/分钟，请稍后重试或在配置中提供 githubToken'
        : `GitHub API ${res.status}`,
    ), { status: res.status })
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return res.json()
}

const SEARCH_CACHE_TTL = 5 * 60 * 1000
const SEARCH_MAX = 100
/** In-memory merged-result cache so paging does not re-hit the GitHub API. */
const searchCache = new Map()

/** Search repos that plausibly host skills. Priority: code search for SKILL.md (token),
 *  dsh-skill topic repos, then generic keyword repos. Results carry a `hasSkill` flag.
 *  Merges up to SEARCH_MAX results and caches them for SEARCH_CACHE_TTL. */
async function searchRepos(query) {
  const q = String(query || '').trim()
  const hit = searchCache.get(q)
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return hit.items

  const seen = new Map()
  const add = (items, hasSkill) => {
    for (const it of items || []) {
      if (!it || !it.full_name || seen.has(it.full_name)) continue
      seen.set(it.full_name, {
        fullName: it.full_name,
        owner: it.owner?.login || '',
        repo: it.name || '',
        description: it.description || '',
        stars: it.stargazers_count ?? 0,
        updatedAt: it.updated_at || '',
        url: it.html_url || `https://github.com/${it.full_name}`,
        topics: Array.isArray(it.topics) ? it.topics : [],
        hasSkill,
      })
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    // 1) code search: repos actually containing SKILL.md (needs token; skipped otherwise)
    if (_token) {
      const cq = q ? `filename:SKILL.md ${q}` : 'filename:SKILL.md'
      try {
        const url = `${GH_API}/search/code?q=${encodeURIComponent(cq)}&per_page=${SEARCH_MAX}`
        const data = await ghJson(url, ctrl.signal)
        for (const item of data.items || []) {
          const r = item.repository
          if (r && r.full_name) add([r], true)
        }
      } catch { /* fall through */ }
    }
    // 2) topic repos
    const topicQ = q ? `${q} topic:dsh-skill` : 'topic:dsh-skill'
    try {
      const url = `${GH_API}/search/repositories?q=${encodeURIComponent(topicQ)}&sort=stars&order=desc&per_page=${SEARCH_MAX}`
      const data = await ghJson(url, ctrl.signal)
      add(data.items, true)
    } catch { /* fall through */ }
    // 3) generic keyword fallback (also when a query is given and topic hits are few)
    const genQ = q || 'skill in:name,description,readme'
    try {
      const url = `${GH_API}/search/repositories?q=${encodeURIComponent(genQ)}&sort=stars&order=desc&per_page=${SEARCH_MAX}`
      const data = await ghJson(url, ctrl.signal)
      add(data.items, false)
    } catch { /* fall through */ }
  } finally {
    clearTimeout(timer)
  }
  const items = [...seen.values()].slice(0, SEARCH_MAX)
  // skill-first ordering: code-search/topic hits above generic hits, then by stars
  items.sort((a, b) => (b.hasSkill - a.hasSkill) || (b.stars - a.stars))
  searchCache.set(q, { ts: Date.now(), items })
  return items
}

/** Inspect one repo: default branch + where SKILL.md lives in its tree. */
async function inspectRepo(owner, repo) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const meta = await ghJson(`${GH_API}/repos/${owner}/${repo}`, ctrl.signal)
    const branch = meta.default_branch || 'main'
    const tree = await ghJson(`${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, ctrl.signal)
    const paths = (tree.tree || []).map((t) => t.path)
    const skills = []
    if (paths.includes('SKILL.md')) skills.push({ name: skillName(repo), path: 'SKILL.md' })
    for (const p of paths) {
      const m = p.match(/^skills\/([^/]+)\/SKILL\.md$/)
      if (m) skills.push({ name: skillName(m[1]), path: p })
    }
    for (const p of paths) {
      const m = p.match(/^skills\/([^/]+)\.md$/)
      if (m) skills.push({ name: skillName(m[1]), path: p })
    }
    // dedupe by name
    const byName = new Map()
    for (const s of skills) if (!byName.has(s.name)) byName.set(s.name, s)
    return {
      owner, repo, fullName: `${owner}/${repo}`, defaultBranch: branch,
      description: meta.description || '', stars: meta.stargazers_count ?? 0,
      url: meta.html_url || `https://github.com/${owner}/${repo}`,
      skills: [...byName.values()],
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download a repo tarball, extract it, find every skill it contains and copy
 * it into installDir. Returns the list of installed skills.
 */
async function installRepo({ owner, repo, ref, installDir }) {
  const meta = await inspectRepo(owner, repo)
  const branch = ref || meta.defaultBranch

  const tarballUrl = `${CODELOAD}/${owner}/${repo}/tar.gz/${branch}`
  const res = await fetch(tarballUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`下载 tarball 失败: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  const tmp = join(tmpdir(), `dsh-sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(tmp, { recursive: true })
  const tarballPath = join(tmp, 'src.tar.gz')
  writeFileSync(tarballPath, buf)
  try {
    execFileSync('tar', ['-xzf', tarballPath, '-C', tmp], { stdio: 'ignore', timeout: 120000 })
    // the archive extracts to <repo>-<ref>/
    const dirs = readdirSync(tmp).filter((n) => n !== 'src.tar.gz')
    const root = dirs.length === 1 ? join(tmp, dirs[0]) : tmp

    mkdirSync(installDir, { recursive: true })
    const installed = []

    // 1) single-skill repo: <root>/SKILL.md → whole tree as <installDir>/<name>/
    if (existsSync(join(root, 'SKILL.md'))) {
      const dest = join(installDir, skillName(repo))
      rmSync(dest, { recursive: true, force: true })
      copyTree(root, dest)
      installed.push({ name: skillName(repo), path: dest, description: readDescription(join(dest, 'SKILL.md')) })
    }

    // 2) multi-skill repo: <root>/skills/<name>/SKILL.md or <root>/skills/<name>.md
    const skillsDir = join(root, 'skills')
    if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
      for (const entry of readdirSync(skillsDir)) {
        const p = join(skillsDir, entry)
        if (statSync(p).isDirectory()) {
          if (!existsSync(join(p, 'SKILL.md'))) continue
          const dest = join(installDir, skillName(entry))
          rmSync(dest, { recursive: true, force: true })
          copyTree(p, dest)
          installed.push({ name: skillName(entry), path: dest, description: readDescription(join(dest, 'SKILL.md')) })
        } else if (entry.endsWith('.md')) {
          const dest = join(installDir, skillName(entry.slice(0, -3)) + '.md')
          copyTree(p, dest)
          installed.push({ name: skillName(entry.slice(0, -3)), path: dest, description: readDescription(dest) })
        }
      }
    }

    if (installed.length === 0) {
      throw new Error('该仓库里没有找到 SKILL.md，看起来不是技能仓库')
    }
    return { owner, repo, branch, installed }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Recursive copy without git metadata (files are small; sync is fine for UI ops).
 *
 * LOCAL PATCH (uniterra): entries are copied by their OWN kind — a symlink (or
 * any other non-regular file) is SKIPPED, never followed. Upstream followed
 * links (statSync + copyFileSync), so a repository shipping `leak ->
 * ~/.ssh/id_ed25519` made a one-click install copy bytes from OUTSIDE the
 * downloaded repository into the model-readable skill root, and a link to a
 * directory walked that whole tree in. */
function copyTree(src, dest) {
  const st = lstatSync(src)
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true })
    for (const entry of readdirSync(src)) {
      if (entry === '.git' || entry === '.gitignore') continue
      copyTree(join(src, entry), join(dest, entry))
    }
  } else if (st.isFile()) {
    mkdirSync(join(dest, '..'), { recursive: true })
    // plain copy — small skill files
    copyFileSync(src, dest)
  }
}

/* ---------------- installed / uninstall ---------------- */

function listInstalled(installDir) {
  if (!existsSync(installDir)) return []
  return readdirSync(installDir).sort().flatMap((name) => {
    if (name.startsWith('.')) return []
    const d = join(installDir, name)
    let desc = ''
    if (statSync(d).isDirectory()) {
      const md = join(d, 'SKILL.md')
      if (!existsSync(md)) return []
      desc = readDescription(md)
    } else if (!name.endsWith('.md')) {
      return []
    } else {
      desc = readDescription(d)
    }
    return [{ name, path: d, description: desc }]
  })
}

function uninstallSkill(installDir, name) {
  if (!/^[\w.-]+$/.test(name)) return [false, '非法名称']
  const target = join(installDir, name)
  if (!existsSync(target)) return [false, '找不到该 skill: ' + name]
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  renameSync(target, join(installDir, `.trash-${ts}-${name}`))
  return [true, '已移除 ' + name + '（移入 .trash，可手动恢复）']
}

/* ---------------- HTTP ---------------- */

const REPO_NAME_RE = /^[A-Za-z0-9_.-]+$/

/**
 * Accept a full GitHub URL (https://github.com/owner/repo[/tree/...]) or a
 * bare "owner/repo" string. Returns { owner, repo } or null when invalid.
 */
function parseRepoInput(input) {
  const s = String(input || '').trim()
  if (!s) return null
  let path = s
  try {
    const u = new URL(s)
    if (u.protocol && !/^https?:$/.test(u.protocol)) return null
    if (u.hostname && u.hostname !== 'github.com') return null
    if (u.hostname) path = u.pathname
  } catch { /* not a URL — treat as owner/repo */ }
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo] = parts
  if (!REPO_NAME_RE.test(owner) || !REPO_NAME_RE.test(repo)) return null
  return { owner, repo }
}

/** Parse `url` first, then fall back to owner/repo params (GET) or fields (POST). */
function resolveRepoInput({ url, owner, repo }) {
  const parsed = parseRepoInput(url)
  if (parsed) return parsed
  if (owner && repo && REPO_NAME_RE.test(owner) && REPO_NAME_RE.test(repo)) return { owner, repo }
  return null
}

async function handleApi(installDir, req, res) {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/skill-market/api/search') {
      const q = url.searchParams.get('q') || ''
      const perPage = Math.min(Math.max(parseInt(url.searchParams.get('perPage') || '10', 10) || 10, 1), 50)
      const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
      const all = await searchRepos(q)
      const total = all.length
      const totalPages = Math.max(1, Math.ceil(total / perPage))
      const start = (page - 1) * perPage
      return sendJson(res, 200, {
        ok: true,
        items: all.slice(start, start + perPage),
        page, perPage, total, totalPages,
      })
    }
    if (req.method === 'GET' && url.pathname === '/skill-market/api/repo') {
      const parsed = resolveRepoInput({
        url: url.searchParams.get('url'),
        owner: url.searchParams.get('owner'),
        repo: url.searchParams.get('repo'),
      })
      if (!parsed) return sendJson(res, 400, { ok: false, message: '需要有效的 GitHub 仓库地址（https://github.com/owner/repo 或 owner/repo）' })
      const info = await inspectRepo(parsed.owner, parsed.repo)
      return sendJson(res, 200, { ok: true, ...info })
    }
    if (req.method === 'POST' && url.pathname === '/skill-market/api/install') {
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: 'untrusted origin' })
      const body = await readBody(req)
      const parsed = resolveRepoInput({
        url: body?.url,
        owner: body?.owner,
        repo: body?.repo,
      })
      if (!parsed) return sendJson(res, 400, { ok: false, message: '需要有效的 GitHub 仓库地址（https://github.com/owner/repo 或 owner/repo）' })
      const result = await installRepo({ owner: parsed.owner, repo: parsed.repo, ref: body?.ref, installDir })
      return sendJson(res, 200, { ok: true, ...result })
    }
    if (req.method === 'GET' && url.pathname === '/skill-market/api/installed') {
      return sendJson(res, 200, { ok: true, installDir, items: listInstalled(installDir) })
    }
    if (req.method === 'POST' && url.pathname === '/skill-market/api/uninstall') {
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, message: 'untrusted origin' })
      const body = await readBody(req)
      const [ok, message] = uninstallSkill(installDir, String(body?.name || ''))
      return sendJson(res, 200, { ok, message })
    }
    sendJson(res, 404, { ok: false, message: 'not found' })
  } catch (e) {
    sendJson(res, 500, { ok: false, message: '出错: ' + String((e && e.message) || e) })
  }
}

export function apply(ctx, config) {
  // LOCAL PATCH: the same resolver as the Config default, evaluated at apply
  // time so the LIVE DSH_HOME wins over the author-environment default.
  const installDir = resolveSkillRoot({
    explicit: config?.installDir,
    dshHome: process.env.DSH_HOME,
  })
  let token = config?.githubToken || ''
  if (!token && config?.githubTokenFile) {
    try { token = readFileSync(config.githubTokenFile, 'utf8').trim() } catch {}
  }
  if (!token && process.env.GITHUB_TOKEN) token = process.env.GITHUB_TOKEN
  setToken(token)

  const handler = (req, res) => handleApi(installDir, req, res)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/skill-market', handler }),
    'skill-market: api routes')
  ctx.logger?.info?.(`skill-market: API ready at /skill-market/api/* (installDir=${installDir}${token ? ', token: yes' : ''})`)
}
