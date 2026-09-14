# Agent Note: Recover edited scene drafts against current sources

Status: implemented

A retained native scene session predated a restored asset design. Even after the operator corrected the candidate against the current saved design, the shared composer rejected its historical session source key before the scene owner could validate the edited content. Repeating a model request was unnecessary.

The shared composer exposes an optional owner callback for a changed local edit of a stale result. Only scene design supplies it, using the same script/scene/asset, dialogue, camera and fresh-read validation as normal adoption. The button explicitly says it will check the edit against current sources. Unedited stale results and consumers without an owner validator remain rejected. This does not relabel the original session, update its source key, save project data, or grant creative approval. Semantic review remains the operator's responsibility; matching hashes alone does not prove the draft faithfully reflects the sources.

Focused tests cover the corrected current edit, stale asset hash, wrong script and a second asset change during adoption, together with the generic composer's retained stale-edit refusal. The running browser repeats the retained-session edit, ordinary planning save and recovery on the rain workflow project; the verification directory retains the failed request path and successful result separately.
