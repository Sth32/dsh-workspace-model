#!/usr/bin/env bash
# Tests use a new profile and two synthetic provider routes.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
cli=${DSH_TEST_CLI:?absolute path to installed DSH lib/bin.js}
webport=${DSH_TEST_WEB_PORT:-43221}
mockport=${DSH_TEST_MOCK_PORT:-43220}
temp=$(mktemp -d)
printf 'Fixture: %s\n' "$temp"
mock_pid= web_pid=
stop() {
  if [[ -n $web_pid ]]; then kill "$web_pid" 2>/dev/null || true; wait "$web_pid" 2>/dev/null || true; web_pid=; fi
}
cleanup() {
  stop
  if [[ -n $mock_pid ]]; then kill "$mock_pid" 2>/dev/null || true; fi
  if [[ ${DSH_TEST_KEEP:-0} != 1 ]]; then rm -rf "$temp"; fi
}
trap cleanup EXIT
tgz=$(npm pack --silent --pack-destination "$temp")
export HOME="$temp/user" DSH_HOME="$temp/dsh"
export XDG_CONFIG_HOME="$HOME/config" XDG_CACHE_HOME="$HOME/cache" XDG_DATA_HOME="$HOME/data" PNPM_HOME="${DSH_TEST_PNPM_CACHE:-$HOME/pnpm}"
export DSH_TEST_MODEL_KEY=isolated-local-fixture
mkdir -p "$HOME" "$DSH_HOME/storages"
export DSH_TEST_BETTER=0
if [[ -n ${DSH_TEST_PROFILE_TEMPLATE:-} ]]; then
  # Offline fallback: reuse package dependencies only, never an account or sessions.
  target="$DSH_HOME/profiles/web"
  mkdir -p "$target"
  for file in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.yml node_modules; do
    if [[ -e $DSH_TEST_PROFILE_TEMPLATE/$file ]]; then cp -a "$DSH_TEST_PROFILE_TEMPLATE/$file" "$target/"; fi
  done
  plugin="$target/node_modules/dsh-workspace-model"
  rm -rf "$plugin"
  mkdir -p "$plugin"
  tar -xzf "$temp/$tgz" -C "$plugin" --strip-components=1
  if [[ -d $target/node_modules/dsh-better-workspace ]]; then DSH_TEST_BETTER=1; fi
else
  node "$cli" plugin --profile web add "$temp/$tgz"
  if [[ -n ${DSH_TEST_BETTER_TGZ:-} ]]; then
    node "$cli" plugin --profile web add "$DSH_TEST_BETTER_TGZ"
    DSH_TEST_BETTER=1
  fi
fi
python3 - "$mockport" "${DSH_TEST_AGENT_PRESET:-standard}" <<'PY'
import datetime, json, os, pathlib, sys, uuid
home=os.environ["HOME"]; dsh=os.environ["DSH_HOME"]; port, preset=sys.argv[1:3]
assert preset in ("standard", "ptc")
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
rows={}
for title,path in [("MatrixRoot","MatrixRoot"),("MatrixChild","MatrixRoot/MatrixChild"),
                   ("MatrixLeaf","MatrixRoot/MatrixChild/MatrixLeaf"),("MatrixOther","MatrixRoot-unrelated")]:
    path=pathlib.Path(home,path)
    path.mkdir(parents=True,exist_ok=True)
    rows[str(uuid.uuid4())]=dict(path=str(path),title=title,sessionIds=[],createdAt=now,updatedAt=now)
pathlib.Path(dsh,"storages/workspace.json").write_text(json.dumps({
    "unit":{"name":"workspace","version":2},
    "global":{"initialized":True,"workspaceIds":list(rows),"archivedSessionIds":[],"pinnedSessionIds":[]},
    "tables":{"workspaces":rows}}))
pathlib.Path(dsh,"profiles/web/cordis.patch.yml").write_text(f"""- id: ui-settings-general
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: agent-preset-registry
  config:
    default: {preset}
- id: agent-default-model
  config:
    provider: test-models
    model: mock-general
- id: llm-pi-ai
  config:
    providers:
      test-models:
        displayName: Fixture 1
        apiKeyEnv: DSH_TEST_MODEL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:{port}/test-models/v1
        models:
          - id: mock-general
            name: General
          - id: mock-review
            name: Review
            reasoningEfforts:
              low: low
          - id: mock-coding
            name: Coding
            reasoningEfforts:
              high: high
      parent-models:
        displayName: Fixture 2
        apiKeyEnv: DSH_TEST_MODEL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:{port}/parent-models/v1
        models:
          - id: mock-parent
            name: Parent
            reasoningEfforts:
              medium: medium
""")
PY
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export DSH_TEST_BROWSER_STATE="$temp/browser.json"
export DSH_TEST_MOCK_LOG="$temp/mock.jsonl"
python3 "$root/e2e/mock.py" "$mockport" >"$DSH_TEST_MOCK_LOG" & mock_pid=$!
for phase in matrix restart; do
  export DSH_TEST_PHASE="$phase"

  (cd "$HOME"; exec node "$cli" web --port "$webport" --no-open) >"$temp/host.log" 2>&1 & web_pid=$!
  for i in {1..60}; do grep -q 'dsh web: http' "$temp/host.log" && break; sleep .4; done
  DSH_TEST_URL=$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9_-]+' "$temp/host.log")
  export DSH_TEST_URL
  node "$root/e2e/workspace-model.cjs"
  stop
done
