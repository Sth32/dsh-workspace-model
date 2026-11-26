# DSH Web browser regression

Use Node.js 24, Python 3, Playwright and its Chromium. Install the exact DSH host version in a separate test directory, and point to its `lib/bin.js`:

```sh
npm install --no-save playwright
export PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/playwright"
npx playwright install chromium
DSH_TEST_CLI=/absolute/path/to/node_modules/@deepseek-ai/dsh/lib/bin.js bash e2e/run.sh
```

Set `DSH_TEST_BETTER_TGZ` to the path of the Better Workspace release archive to replace the native sidebar. Set `DSH_TEST_AGENT_PRESET=ptc` to test DSH's PTC preset. The runner packs this checkout, uses a new temporary profile, and points two DSH providers to a loopback mock. It never reads a user profile or calls a remote model. Run separately for each host/sidebar/preset combination.

For an offline rerun only, `DSH_TEST_PROFILE_TEMPLATE` can point to a **disposable** Web fixture profile containing already-installed test dependencies. This copies the fixture's profile package files, replaces the plugin with the current archive, then overwrites the host settings with the mock configuration; no sessions or credentials are copied. `DSH_TEST_CHROMIUM` can point to a locally available Chromium binary. Set `DSH_TEST_KEEP=1` to keep the disposable fixture log and profile for debugging.

The browser checks the workspace label and displayed model/effort **before sending**. The runner then asserts on the receiving provider path, model ID and reasoning effort for the first message. Title-generation requests do not count as message delivery. This covers a fixed parent on a separate provider, independently assigned descendants, switching through the composer picker without first sending, inheritance, overrides, clearing, reload, and Host restart.

The restart regression deliberately leaves an existing parent draft on its old
plugin-selected model, saves a new parent rule, restarts the same DSH host, and
asserts that the **same session ID** now uses the new model. A second draft is
explicitly hand-picked before restart and must retain that choice; a new child
session then uses its assigned rule again. Set `DSH_TEST_STALE_PROBE=0` only to
run the non-regression matrix against older builds without this fix.
