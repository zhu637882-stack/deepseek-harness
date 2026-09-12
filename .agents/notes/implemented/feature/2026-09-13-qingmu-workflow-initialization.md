# Agent Note: Read new and existing projects without inventing readiness

Status: implemented

## Problem and decision

A three-project browser audit found that every new-project stage rejected the legitimate missing-storyboard projection. Shooting also read scene planning before scope initialization. Separately, old generated reference candidates with real provenance but no qualification were rejected because the reader equated absence of qualification with absence of source.

The reader accepts only the exact coherent unplanned projection, retaining false validity, null revision and blockers. Existing-revision tools wait for a real revision. Planning reads wait for scope. Generated candidates retain source episode, job and revision while remaining unqualified and unselected. Inconsistent sources and forged qualification still fail.

## Verification and limits

Adapter tests cover empty versus corrupt graphs and pending versus forged qualifications. Component regressions cover scope loading. Type checking verifies consumers handle null revisions. Live validation covers five stages in two new projects and one existing project. These checks verify navigation and reads; they do not establish full generation or spatial quality acceptance.
