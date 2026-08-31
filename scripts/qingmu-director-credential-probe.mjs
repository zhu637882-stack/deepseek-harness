#!/usr/bin/env node
/** Resolve one Director credential through DSh without consuming the prepared call. */

import { Context } from '../vendor/cordis/lib/index.js'
import LocalCredentialProvider from '../packages/credentials/credentials-local/lib/index.js'
import LlmRuntime from '../packages/llm/llm/lib/index.js'
import * as LlmDeepSeek from '../packages/llm/llm-deepseek/lib/index.js'

const [credentialPath, expectedBaseUrl] = process.argv.slice(2)
if (!credentialPath || expectedBaseUrl !== 'https://api.deepseek.com') {
  process.stderr.write('{"error":"director_credential_probe_configuration_invalid"}\n')
  process.exit(1)
}

const ctx = new Context()
let stage = 'credentials'
try {
  await ctx.plugin(LocalCredentialProvider, { path: credentialPath, watch: false })
  stage = 'llm-runtime'
  await ctx.plugin(LlmRuntime)
  stage = 'deepseek-adapter'
  await ctx.plugin(LlmDeepSeek, {
    baseURL: expectedBaseUrl,
    thinking: 'disabled',
    reasoningEffort: 'off',
    maxTokens: 512,
    retryPolicy: { mode: 'normal', maxRetries: 0 },
  })
  stage = 'prepare-call'
  const prepared = await ctx.llm.prepareCall({
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'off',
    maxTokens: 512,
  })
  stage = 'binding'
  if (
    prepared.transport?.baseURL !== expectedBaseUrl
    || prepared.config?.model !== 'deepseek-v4-pro'
    || prepared.retryPolicy?.maxRetries !== 0
  ) {
    throw new Error('prepared binding mismatch')
  }
  process.stdout.write(JSON.stringify({
    available: true,
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    baseUrl: expectedBaseUrl,
    maxRetries: 0,
    transportConsumed: false,
  }) + '\n')
} catch {
  process.stderr.write(JSON.stringify({ error: 'director_credential_unavailable', stage }) + '\n')
  process.exitCode = 1
} finally {
  await ctx.fiber.dispose()
}
