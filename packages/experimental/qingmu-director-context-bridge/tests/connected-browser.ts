/** Optional browser harness. It forwards real handlers, never mocks business or method responses. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Exercise one synthetic project in Chrome against actual service handlers.
 * @param root Owned temporary directory used for the build cache.
 * @param boot Non-secret scope and session coordinates.
 * @param edited Expected first-frame text after manual editing.
 * @param handlers Real read, command, method and session bridge handlers.
 * @param timeoutMs Bounded browser deadline; shorter values exercise failure cleanup.
 * @returns Completion only after the browser succeeds and its server closes.
 */
export async function runConnectedBrowser(root: string, boot: unknown, edited: string,
  handlers: Record<string, (endpoint: string, input: unknown, signal: AbortSignal) => Promise<unknown>>,
  timeoutMs = 45000) {
  if (process.platform === 'win32') throw new Error('Connected browser fixture requires POSIX process groups')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000) throw new Error('Invalid browser deadline')
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vitest'))
  const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href)
  const cockpitRequire = createRequire(new URL('../../client-ui-qingmu-cockpit/package.json', import.meta.url))
  const directory = dirname(fileURLToPath(import.meta.url))
  const allowed = new Set(['read/promptIrBootstrap', 'method/promptIrBootstrapMethod',
    'command/bootstrapPromptIr', 'command/recoverPromptIrBootstrap', 'command/selectBootstrapPromptIr',
    'command/recoverPromptIrSelection', 'bridge/readNativeFirstDraftProposal'])
  const server = await createServer({ configFile: false, root: directory, cacheDir: join(root, '.vite'),
    esbuild: { jsx: 'automatic' },
    resolve: { alias: ['react/jsx-dev-runtime', 'react/jsx-runtime', 'react-dom/client', 'react-dom', 'react']
      .map(name => ({ find: new RegExp(`^${name}$`), replacement: cockpitRequire.resolve(name) })) },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [join(directory, '../../../..')] } },
    plugins: [{ name: 'connected-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url === '/') {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/', '<div id="root"></div><script type="module" src="/connected-browser.tsx"></script>'))
          return
        }
        if (request.url === '/fixture/boot') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(boot)); return }
        const path = request.url?.replace(/^\/fixture\/rpc\//, '')
        if (!path || !allowed.has(path) || request.method !== 'POST') { next(); return }
        try {
          let body = ''
          for await (const chunk of request) { body += String(chunk); if (body.length > 2_000_000) throw new Error('Fixture body too large') }
          const [namespace, endpoint] = path.split('/')
          const result = await handlers[namespace]!(endpoint!, JSON.parse(body), AbortSignal.timeout(20000))
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result))
        } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ ok: false, error: String(error) })) }
      })
    } }],
  })
  try {
    await server.listen()
    const url = server.resolvedUrls.local[0]
    await new Promise<void>((resolve, reject) => {
      const child = spawn('python3', ['-B', join(directory, 'connected-browser.py'), url, edited], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, TMPDIR: root, PYTHONUNBUFFERED: '1',
          ...(process.env.QINGMU_BROWSER_CHANNEL ? { QINGMU_BROWSER_CHANNEL: process.env.QINGMU_BROWSER_CHANNEL } : {}) },
      })
      let output = ''
      let timedOut = false
      let escalation: ReturnType<typeof setTimeout> | undefined
      // detached creates a private POSIX group; never signal the invoking shell's group.
      const terminateGroup = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return
        try { process.kill(-child.pid, signal) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error)
        }
      }
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + String(chunk)).slice(-8000) })
      const timer = setTimeout(() => {
        timedOut = true
        terminateGroup('SIGTERM')
        escalation = setTimeout(() => terminateGroup('SIGKILL'), 2000)
      }, timeoutMs)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => {
        clearTimeout(timer); clearTimeout(escalation)
        terminateGroup('SIGKILL') // Also reap a driver/browser left by a crashed Python parent.
        if (timedOut) reject(new Error('Connected browser timed out; owned process group terminated'))
        else if (code === 0) resolve()
        else reject(new Error(output || `Browser exited ${code}`))
      })
    })
  } finally { await server.close() }
}
