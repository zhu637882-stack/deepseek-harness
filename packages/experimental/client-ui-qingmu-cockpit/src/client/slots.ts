import type { QingmuYimengPort } from './contracts.ts'

/** Dependencies injected into the Qingmu cockpit's sidebar slot occupant. */
export interface QingmuCockpitFace {
  readonly port: QingmuYimengPort
}
