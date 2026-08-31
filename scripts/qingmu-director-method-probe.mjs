#!/usr/bin/env node
/** Materialize the current IMAGO Director method from its authoritative source bytes. */

import { resolve } from 'node:path'

import { loadDirectorReplayMethod } from '../packages/experimental/qingmu-imago-method-adapter/lib/index.js'

const [coreRoot] = process.argv.slice(2)
if (!coreRoot) {
  process.stderr.write('{"error":"director_method_probe_configuration_invalid"}\n')
  process.exit(1)
}

try {
  const method = await loadDirectorReplayMethod(resolve(coreRoot))
  process.stdout.write(JSON.stringify({
    version: method.version,
    methodPackageSha256: method.methodPackageSha256,
    sourceBindings: method.sourceBindings,
  }) + '\n')
} catch {
  process.stderr.write('{"error":"director_method_materialization_failed"}\n')
  process.exitCode = 1
}
