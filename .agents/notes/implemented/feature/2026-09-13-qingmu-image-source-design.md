# Agent Note: Retain image source design across the creative workflow

Status: implemented

## Decision

The image task saves the authored asset design and its linked scene at generation time. The authenticated catalog projects creative fields from that saved configuration; image inspection delivers them with the same image bytes to the native director. Asset and shot editors expose the same source. Current drafts never replace missing historical descriptions. Project changes reset the asset reference library.

## Rationale

A picture catalog containing only identifiers and labels omitted the camera, staging and state originally intended for each picture. Reconstructing those from the latest editable design incorrectly assigned new intentions to old pixels. The existing generation configuration supplies the needed record without another database or paid operation.

## Verification and limits

Focused queue tests retain actor staging and shared layout after a later scene edit. Adapter tests use Writer’s serialized configuration and cover missing or malformed history. Native composition tests deliver original design and image pixels to the following model request; UI tests cover source display and project switching. The saved text is historical intent, not evidence that the generated picture obeyed it. This change does not establish spatial continuity or repair existing media.
