# Run Qingmu locally on macOS

English | [中文](qingmu-local.zh.md)

This guide starts a dedicated single-user Qingmu instance with a persistent SQLite database. It does not upgrade another Yimeng installation. Prerequisites: this Harness checkout built with `pnpm run build --profile qingmu`, Node, Python 3, the Yimeng Writer checkout with its `.venv`, and IMAGO Core.

## Initialize and open

Run from the Harness directory. Initialization refuses any existing destination directory. The default is `~/Library/Application Support/QingmuOS`; add `--root /absolute/new/path` to every command for a custom instance.

```sh
python3 scripts/qingmu-local.py init --yimeng-root /Users/a1234/yimeng-worktrees/qingmu-phase3-changeset-20260826 --core-root /Users/a1234/Downloads/imago-os-core
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
python3 scripts/qingmu-local.py status
```

Open the `webUrl` printed by `status`, choose “进入青木 OS”, then “先以只读方式进入” on first use and “青木制作台”. The first-use option skips model setup, not the authenticated Draft command permissions. `ready: true` requires both owned processes, the API's exact database/storage identity, and the Host's loopback listener and page. Login is a separate status. An empty installation has no projects; the cockpit cannot yet create a new project. This is a persistent integration environment, not complete product acceptance.

## Stop, restart and renew login

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py start
python3 scripts/qingmu-local.py login
```

Stopping preserves data. Starting never reseeds projects. Ports remain stable across restarts; an occupied saved port fails without killing its owner. Repeated start reports the same live instance. A stale PID is diagnostic only; commands never signal it. A broken or externally killed supervisor fails closed and may need operator diagnosis of its orphaned children; do not kill an unknown listener by port.

The dedicated local account uses a random password in `private/login.json`, protected by the current macOS user's private directory. `login` submits that credential to the existing API, renews its normal 24-hour JWT and restarts only this instance's Host. It neither changes business data nor replays commands. Refresh the browser afterward. If a save outcome is unknown, query its original receipt before retrying; do not create a second command. This device-local identity is not evidence of human content approval. Anyone with access to this macOS account or its loopback service has the local user's capabilities.

## Data and backup reference

`storage/jason.db` and `storage/` hold Yimeng data/media; `dsh/` is the independent Harness home/profile; `private/` holds secrets/session/configuration; `logs/` holds startup diagnostics. Keep the whole root private. Neither private files nor backups belong in Git. The launcher scrubs inherited credentials, never reads an old production `.env`, binds only `127.0.0.1`, and leaves paid Provider access disabled.

```sh
python3 scripts/qingmu-local.py stop
python3 scripts/qingmu-local.py backup
python3 scripts/qingmu-local.py restore --backup /absolute/backup/path --root /absolute/new/restore-path
python3 scripts/qingmu-local.py start --root /absolute/new/restore-path
python3 scripts/qingmu-local.py login --root /absolute/new/restore-path
```

Backup requires confirmed clean shutdown, creates a new timestamped directory, and checks SQLite integrity plus media SHA-256. A free lock after an abnormal supervisor exit does not prove shutdown: a persistent dirty marker blocks start/backup and reports unknown status until operator diagnosis. Restore requires the complete storage hash inventory and writes only a nonexistent new directory; it preserves the source instance, allocates a new process identity and requires login. Keep a verified backup before changing the bound source checkouts. Stop this instance and return to the recorded source commits to roll back code; database schema rollback is not automatic.

The launcher does not install system autostart, expose a public server, migrate formal data, run Provider jobs, or sign off content. See the [ownership decision](../../.agents/notes/implemented/architecture/2026-08-29-qingmu-local-instance.md).
