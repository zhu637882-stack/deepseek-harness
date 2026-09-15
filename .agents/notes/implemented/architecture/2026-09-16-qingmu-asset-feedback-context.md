# Asset feedback as attributed request context

Scene feedback brought to the asset page accompanies the next native design request automatically. It remains separate from optional user supplements and carries project, episode, scene and source digests. Changed source versions require reconsideration; feedback is neither a current fact nor an instruction to approve, save or regenerate media.

The existing browser-local store remains the owner. Dismissal removes feedback from subsequent requests, and scope changes exclude other projects. Feedback participates in the candidate source key so removing an opinion cannot silently rebase an existing candidate. This closes the extra manual-copy step without adding a reviewer, provider call or retry loop. Cross-device feedback persistence remains outside this change.

Verification uses the native asset component through request dispatch: recovered feedback reaches the request with empty supplements, source changes are attributed, dismissed and foreign-project feedback do not travel, and no save or generation is triggered by carrying feedback.
