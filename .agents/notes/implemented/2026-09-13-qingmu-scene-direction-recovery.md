# Recovering scene direction and sending revision requests

The ordinary scene-design page displayed a completed native director response but offered no adoption button when its JSON was fenced as `json` instead of `txt`. Enable the shared composer's single-JSON-block recovery; keep source SHA, asset freshness and complete dialogue coverage checks. The actual original session is recovered without a new model call.

Add an editable scene direction field so an owner can request pacing, performance, camera or prior-draft changes using the existing native session. Requests include the same scene and full-film source. The field does not change the saved script or media and does not bypass explicit plan adoption and saving.

Whole-scene save cancellation follows project, episode and scene lifetime. Refreshing the displayed storyboard revision only cancels an obsolete source read, keeping an in-progress scene save alive. The next shot still checks actual current script, storyboard and shared-source hashes. This separates ordinary updates produced by the batch from real external drift; uncertain replies retain their exact request for recovery.

Verification: the JSON-fence regression failed before the fix; eight scene-direction checks and the target TypeScript project pass. Runtime recovery is recorded under the Qingmu implementation verification/full-flow-20260913 directory.
