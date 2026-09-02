# Run Qingmu locally on macOS

English | [中文](qingmu-local.zh.md)

This guide starts a dedicated single-user Qingmu instance with a persistent SQLite database. It does not upgrade another Yimeng installation. The one launcher owns the Yimeng API, the DSh Host/director service, and the Yimeng six-stage frontend. Prerequisites: this Harness checkout built with the Qingmu profile, Node 20, Python 3, the Yimeng Writer checkout with its `.venv` and a production frontend build made with `QINGMU_LOCAL_RUNTIME_PROXY=1`, and IMAGO Core. Initialization records the first local build identity; after either checkout or its artifacts change, stop the instance, complete both builds, and run `record-build` before the next start.

## Initialize and open

Run from the Harness directory. Initialization refuses any existing destination directory. The default is `~/Library/Application Support/QingmuOS`; add `--root /absolute/new/path` to every command for a custom instance.

```sh
python3 scripts/qingmu-local.py init --yimeng-root /absolute/path/to/yimeng-writer --core-root /absolute/path/to/imago-os-core --frontend-node /absolute/path/to/node20
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
python3 scripts/qingmu-local.py status
```

Open the single `entryUrl` printed by `status`. It establishes the normal HttpOnly local session and goes directly to the Qingmu-branded Yimeng project workspace; there is no generic DSh chat or extra Qingmu modal first. `ready: true` requires all four owned children (API, scoped text worker, DSh Host and frontend), the API's exact database/storage identity, the DSh Host listener/page, and the six-stage frontend listener/page. Their status fields remain separate for diagnosis. The six-stage page embeds the scope-bound Director workspace. After a planning save or GET-only recovery, the outer page accepts only the exact iframe origin/source and project/episode scope, rereads canonical planning and Director context, refreshes the workflow projection and locates the saved shot. Rejected or stale notifications stay visible and do not create a false success. This is a persistent integration environment, not complete product acceptance.

## Write the first script

1. In the empty state, enter a project name and choose “新建项目与第 1 集”. Existing projects also have a “新建项目” button. Yimeng creates one project, first season and first episode atomically.
2. In “剧本与资产”, paste text or select a UTF-8 `.txt` file (at most 128 KiB, 64000 characters, 1000 lines). Start each scene with “场景一：地点”; put actions and dialogue on separate lines.
3. Choose “解析并保存预览草稿”. Check scene/action/dialogue classification and correct speakers with “保存校正”. This only saves the parsing draft.
4. Choose “确认导入并保存剧本”. The saved script and version appear below. Refreshing or restarting reads the same server-side script. Assets, storyboards and Takes remain absent until separately created; this action starts no stage or generation and grants no content approval.

If a reply is lost, use “读取创建恢复” or “读取恢复 / 刷新预览” first. Inputs remain in this browser; canonical drafts and scripts live in Yimeng. An explicit same-intent retry cannot duplicate the original operation. When the script version changed and the original import is confirmed absent, “保留文字，按当前版本重新准备” unlocks the retained text without submitting it. An unfinished draft index can be completed only by explicit same-key retry while it is still current. Browser recovery storage is not a backup; a new browser recovers saved data, not unsubmitted local text.

## Plan one scene

1. After saving a script, open “导演工作区”, select one text scene and choose “建立本场镜头”. The two initial cards copy only original action/dialogue; blank narrative and visual fields are not generated suggestions.
2. Enter shot names, narrative purposes, visual descriptions, actions and durations (0.5–30 seconds); check dialogue assignment. Add up to eight shots. Choose “预览保存影响”, then “确认保存规划”.
3. The saved scene, dialogue actors and shots have canonical Yimeng IDs and original source-line bindings. Select a shot, edit its fields and explicitly save a new structural version. Refresh or restart reads those same objects. Reference media and the first legal PromptIR remain separate prerequisites; structural Ready is not content approval.

For an unknown result, choose “读取恢复” before retrying. A rejected intent can be explicitly prepared against the fresh unchanged script after its missing receipt is confirmed. If another session already initialized this scene, “保留输入副本，载入已存在镜头” keeps a browser-only copy and loads the existing objects without overwriting them. Changed script sources cannot be silently rebound. Unsubmitted text survives ordinary re-entry in this browser, not browser-storage deletion.

## Stop, restart and renew login

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py record-build
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
```

Stopping preserves data. `record-build` requires a clean stopped instance and clean Writer/Harness worktrees, then atomically binds their commits, the Core checkout state, the frontend BUILD_ID, required Host artifact SHA-256 values, ports and data root in `build-manifest/current.json`; it retains any preceding record under `build-manifest/history/`. Starting and `status` compare that record with disk and fail closed on missing or drifted identity. Starting never reseeds projects. Ports remain stable across restarts; an occupied saved port fails without killing its owner. Repeated start reports the same live instance. A stale PID is diagnostic only; commands never signal it. A broken or externally killed supervisor fails closed and may need operator diagnosis of its orphaned children; do not kill an unknown listener by port.

After an external supervisor crash, use `recover-crash` only while the instance remains stopped and only with the exact public instance ID. The command holds the lifecycle lock and verifies the generation-numbered process ledger, every recorded PID, each loopback port, the control socket, database/WAL handles and immutable integrity. It never sends a signal or calls a Provider. A durable recovery intent makes an interrupted recovery repeatable; a surviving intent blocks start and backup until the same command finishes it.

```sh
python3 scripts/qingmu-local.py recover-crash --instance-id EXACT_INSTANCE_ID
```

The dedicated local account uses a random password in `private/login.json`, protected by the current macOS user's private directory. `login` submits that credential to the existing API, renews its normal 24-hour JWT and restarts only this instance's Host and frontend so both receive the renewed private session. It neither changes business data nor replays commands. Open the `entryUrl` printed by `status` again so the browser receives the new HttpOnly cookie; refreshing an existing project URL keeps the old cookie. If a save outcome is unknown, query its original receipt before retrying; do not create a second command. This device-local identity is not evidence of human content approval. Anyone with access to this macOS account or its loopback service has the local user's capabilities.

## Rotate local private credentials

If local instance credentials may have been exposed, first stop normally and create a non-overwriting cold backup. After confirming that the current Harness and Writer worktrees are clean, use the exact instance ID from public `status` output:

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py rotate-private-credentials --instance-id EXACT_INSTANCE_ID
```

Rotation runs only while holding the stopped-instance lock. It regenerates the five local credential classes—JWT signing, attestation, control, director execution and editing handoff—together, updates the random `qingmu-local` login password and the one matching database password hash, and clears the old session. It then automatically rebinds the current build identity, starts the instance, proves in the same launcher process that both the old password and prior session are unauthorized, and logs in with the new password. The command and audit receipt report only categories, booleans, timestamps, permissions and public build identity; they never print credentials or hashes. A mismatched instance ID, running instance, account count other than exactly one, private file that is not a `0600` regular file owned by the current user, unknown sibling secret field, or any failed step closes the operation. A controlled failure before commit restores a consistent stopped state.

After rotation, run `stop`, `start` and `status` once more to confirm a full restart remains `ready: true` with a matching build identity. The old cold backup remains available, but `restore` now always regenerates all five credential classes and the local login password for the new directory, synchronizes the new database password hash and discards the old session, so restored data cannot reactivate old authentication values.

## Data and backup reference

`storage/jason.db` and `storage/` hold Yimeng data/media; `dsh/` is the independent Harness home/profile; `private/` holds secrets/session/configuration; `logs/` holds startup diagnostics. Keep the whole root private. Neither private files nor backups belong in Git. The launcher scrubs inherited credentials, never reads an old production `.env`, binds only `127.0.0.1`, and leaves paid Provider access disabled.

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py restore --backup /absolute/backup/path --root /absolute/new/restore-path
python3 scripts/qingmu-local.py record-build --root /absolute/new/restore-path
python3 scripts/qingmu-local.py start --root /absolute/new/restore-path
python3 scripts/qingmu-local.py login --root /absolute/new/restore-path
```

Backup requires confirmed clean shutdown, creates a new timestamped directory, and checks SQLite integrity plus storage, audit and build-manifest SHA-256 values. A missing build identity is recorded as `unknown_missing`, not inferred. A free lock after an abnormal supervisor exit does not prove shutdown: a persistent dirty marker blocks start/backup and reports unknown status until the explicit fail-closed recovery above succeeds. Restore requires the complete hash inventory and writes only a nonexistent new directory; it preserves the source instance, allocates a new process identity, fully rekeys local private credentials and login authentication, and deliberately leaves the copied build identity mismatched until `record-build` binds the new root. Keep a verified backup before changing the bound source checkouts. Stop this instance and return to the recorded source commits to roll back code; database schema rollback is not automatic.

The launcher does not install system autostart, expose a public server, migrate formal data, run Provider jobs, or sign off content. See the [ownership decision](../../.agents/notes/implemented/architecture/2026-08-29-qingmu-local-instance.md).
