# Per-image object staging

Shared blockout cameras previously rendered every object at the common initial position, even when the director described it as moved or absent. Add optional imageObjectStates by stable shared object ID beside imageCamera on asset cards and shot plans. Apply the changes to a render copy, retaining the source room and other images. Preserve omitted values for old clients; explicit null/empty clears. Unknown/duplicate IDs and invalid dimensions fail before generation.

Use the existing asset editor, manual/automatic shot editor, native preview tool and save/recovery paths. Plan SVG still depicts the shared geometry; image-specific controls feed the exact preview and queued composition reference. Native prompts distinguish permanent identity, current staging and later actions. No new service, physics engine, paid retry loop or inferred media acceptance.

Checks cover changed pixels with unchanged base across contexts, scoped API save/preview, old-client preservation/clear, exact queued references and stale input rejection, editor save/recovery, and the shipped native tool loop. Real browser verification is recorded separately from generated-image fidelity.
