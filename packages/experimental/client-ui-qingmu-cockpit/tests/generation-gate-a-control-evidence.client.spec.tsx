// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  QingmuYimengReadPort, YimengGateAControlEvidenceResponse,
} from '../src/client/contracts.ts'
import { GenerationGateAControlEvidence } from '../src/client/GenerationGateAControlEvidence.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

type Port = Pick<QingmuYimengReadPort, 'gateAControlEvidence'>
const t = (key: QingmuCockpitKey) => zh[key]

function evidence(): YimengGateAControlEvidenceResponse {
  return {
    schema: 'jason.qingmu-provider-gate-a-control-evidence.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    gateAStatus: 'PASSED_CONTROL_LOGIC_ONLY',
    mode: 'offline_fault_injection',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    environment: {
      database: 'temporary_sqlite', networkEgressAllowed: false, provider: 'scripted_fake',
      productionCredentialsLoaded: false, temporaryDatabaseWrites: true,
    },
    scenarios: [
      { id: 'unauthorized_request_blocked', outcome: 'passed', providerSubmitAttempts: 0, budgetReserved: false },
      {
        id: 'duplicate_ack_replay', outcome: 'passed', providerSubmitAttempts: 1,
        duplicateAckReplays: 1, duplicatePaidSubmissions: 0,
      },
      { id: 'payload_sha_conflict', outcome: 'passed', providerSubmitAttempts: 1, conflictingSubmitAttempts: 0 },
      {
        id: 'submission_unknown_quarantine', outcome: 'passed', providerSubmitAttempts: 1,
        automaticResubmits: 0, workerOutcomes: ['dispatch_state_unknown'],
      },
      {
        id: 'simulated_reconciliation', outcome: 'passed', providerCalls: 0, deduplicated: true,
        simulatedOperatorDecision: true, humanSignoffInferred: false,
      },
      {
        id: 'poll_recovery', outcome: 'passed', providerSubmitAttempts: 1, providerPollAttempts: 2,
        automaticResubmits: 0, workerOutcomes: ['dispatched', 'error', 'ingested', 'technical_quality_passed'],
      },
      {
        id: 'download_timeout_recovery', outcome: 'passed', providerSubmitAttempts: 1,
        providerPollAttempts: 1, downloadAttempts: 2, automaticResubmits: 0,
        workerOutcomes: ['dispatched', 'download_timeout_retry', 'ingested', 'technical_quality_passed'],
      },
      {
        id: 'truncated_download_rejected', outcome: 'passed', providerSubmitAttempts: 1,
        providerPollAttempts: 1, downloadAttempts: 1, truncatedDownloadsAccepted: 0,
      },
    ],
    assertions: {
      externalProviderCalls: 0, productionDatabaseWrites: 0, formalBudgetLedgerWrites: 0,
      duplicatePaidSubmissions: 0, unknownAutomaticResubmits: 0,
      maximumAutomaticSubmitAttemptsPerDispatch: 1, networkEgressAttempts: 0,
      truncatedDownloadsAccepted: 0, reconciliationProviderCalls: 0,
      pollRecoveryResubmits: 0, downloadRecoveryResubmits: 0,
    },
    sourceBindings: [
      { path: 'backend/src/jason/apps/studio/asset_service.py', sha256: 'a'.repeat(64) },
      { path: 'scripts/qingmu_gate_a_evidence.py', sha256: 'b'.repeat(64) },
    ],
    externalProviderCalls: 0,
    productionDatabaseWrites: 0,
    formalBudgetLedgerWrites: 0,
    simulatedProviderSubmitAttempts: 6,
    paidGenerationAuthorized: false,
    humanSignoffInferred: false,
    evidenceSnapshotSha256: 'c'.repeat(64),
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('missing resolver') }
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Gate A control evidence', () => {
  it('shows all offline scenarios, required zeroes, source hashes, and the production boundary', async () => {
    const port = {
      gateAControlEvidence: vi.fn<Port['gateAControlEvidence']>().mockResolvedValue(evidence()),
    }
    render(<GenerationGateAControlEvidence enabled port={port} t={t} />)

    expect(await screen.findByText(zh.gateAControlPassed)).toBeTruthy()
    expect(screen.getByText(zh.gateAControlUnverified)).toBeTruthy()
    expect(screen.getByText(zh.gateAControlScenarioUnknown)).toBeTruthy()
    expect(screen.getByText(zh.gateAControlScenarioPollRecovery)).toBeTruthy()
    expect(screen.getByText(zh.gateAControlScenarioDownloadRecovery)).toBeTruthy()
    expect(screen.getByText('8/8')).toBeTruthy()
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(6)
    expect(screen.getByText(zh.gateAControlLimit)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /生成|提交|对账/u })).toBeNull()
    expect(port.gateAControlEvidence).toHaveBeenCalledExactlyOnceWith({}, expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: zh.gateAControlRefresh }))
    await waitFor(() => { expect(port.gateAControlEvidence).toHaveBeenCalledTimes(2) })
  })

  it('surfaces a Host rejection without retaining stale evidence', async () => {
    const port = {
      gateAControlEvidence: vi.fn<Port['gateAControlEvidence']>()
        .mockRejectedValue(new Error('source binding stale')),
    }
    render(<GenerationGateAControlEvidence enabled port={port} t={t} />)

    expect((await screen.findByRole('alert')).textContent).toContain('source binding stale')
    expect(screen.queryByText(zh.gateAControlPassed)).toBeNull()
  })

  it('drops a late response after the generation view is disabled', async () => {
    const pending = deferred<YimengGateAControlEvidenceResponse>()
    const port = {
      gateAControlEvidence: vi.fn<Port['gateAControlEvidence']>().mockImplementation(async () => pending.promise),
    }
    const view = render(<GenerationGateAControlEvidence enabled port={port} t={t} />)
    expect(screen.getByRole('status').textContent).toContain(zh.gateAControlLoading)

    view.rerender(<GenerationGateAControlEvidence enabled={false} port={port} t={t} />)
    await act(async () => { pending.resolve(evidence()); await pending.promise })

    expect(screen.queryByText(zh.gateAControlPassed)).toBeNull()
    expect(port.gateAControlEvidence).toHaveBeenCalledOnce()
  })
})
