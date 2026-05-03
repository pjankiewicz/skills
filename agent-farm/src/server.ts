import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '..', 'public')

const PORT = Number(process.env.PORT ?? process.env.AGENT_FARM_PORT ?? 5180)
const RUNS_DIR = resolve(process.env.AGENT_FARM_DIR ?? process.argv[2] ?? './agent-runs')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function listRuns(): Array<{ runId: string; mtimeMs: number }> {
  if (!existsSync(RUNS_DIR)) return []
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => {
      const path = join(RUNS_DIR, d.name)
      return { runId: d.name, mtimeMs: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function safeJoin(base: string, untrusted: string): string | undefined {
  const resolved = resolve(base, untrusted)
  return resolved === base || resolved.startsWith(base + sep) ? resolved : undefined
}

function serveFile(filePath: string, res: import('node:http').ServerResponse, cache = false): void {
  try {
    const data = readFileSync(filePath)
    const headers: Record<string, string> = { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' }
    if (!cache) headers['Cache-Control'] = 'no-store'
    res.writeHead(200, headers)
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

const server = createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400)
    res.end()
    return
  }
  const path = req.url.split('?')[0] ?? '/'

  if (path === '/') return serveFile(join(PUBLIC_DIR, 'dashboard.html'), res)

  // List of runs (newest first)
  if (path === '/api/runs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ dir: RUNS_DIR, runs: listRuns() }))
    return
  }

  // Live access to per-run files
  if (path.startsWith('/runs/')) {
    const rel = path.slice('/runs/'.length)
    const target = safeJoin(RUNS_DIR, rel)
    if (!target) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    return serveFile(target, res)
  }

  // Static
  if (path.startsWith('/public/') || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
    const rel = path.startsWith('/public/') ? path.slice('/public/'.length) : path.slice(1)
    const target = safeJoin(PUBLIC_DIR, rel)
    if (target) return serveFile(target, res, true)
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, () => {
  console.log(`agent-farm dashboard`)
  console.log(`  runs dir : ${RUNS_DIR}`)
  console.log(`  url      : http://localhost:${PORT}/`)
})
