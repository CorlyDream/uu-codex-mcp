# UU Remote integration smoke tests

`uu-smoke.ts` drives the real macOS `GuiTransport` against an **authorized Windows test device**. It is deliberately guarded: if `UU_TEST_DEVICE_ID` is not set, it exits with status `2` and performs no remote action.

## Automated matrix

1. `hostname` single-line output.
2. UTF-8 Chinese output.
3. Empty output.
4. PowerShell error propagation.
5. Native process exit code `7`.
6. `$ | ; " '` special characters.
7. 120-line paged output.
8. 240-character long line.
9. 2-second timeout followed immediately by a recovery command.
10. Ten sequential executions while verifying the local clipboard is restored and no owned terminal remains.

Run only after selecting the exact device ID from `uu_list_devices`:

```bash
export UU_TEST_DEVICE_ID='<exact-authorized-windows-device-id>'
pnpm test:uu
```

The harness never resolves a device by display name. It refuses offline and non-Windows targets before starting the Desktop Helper or opening a remote terminal.

## Human-only negative tests

These scenarios require changing the real desktop/device state and therefore are not automated by the harness.

| Scenario | Procedure | Expected result |
| --- | --- | --- |
| Target offline | Disconnect/stop UU on the authorized test Windows PC, then run one `uu_exec`. | `UU_DEVICE_OFFLINE`; no terminal opens. |
| Accessibility revoked | Remove `uu-desktop-helper` from macOS System Settings → Privacy & Security → Accessibility, then execute. | `UU_ACCESSIBILITY_PERMISSION_DENIED`. |
| Mac screen locked | Start from an unlocked session, lock the Mac before an execution attempt. | Execution must fail closed before keyboard input; current expected code is `UU_TERM_FOCUS_UNPROVEN` (or `UU_GUI_SESSION_UNAVAILABLE` if CoreGraphics rejects input earlier). |
| Ambiguous matching windows | Manually keep two UU terminal windows open whose titles both match the same test device and terminal token. | `UU_TERM_WINDOW_AMBIGUOUS`; no paste/Return is sent. |
| Terminal closed mid-command | Start a slow command, manually close the matching UU terminal, wait for the first call to fail, then run `Write-Output 'RECOVERED'`. | First call: `UU_RESULT_MARKER_TIMEOUT` (or `UU_TERM_WINDOW_NOT_FOUND` if Accessibility reports invalidation immediately); second call succeeds and cleanup/reopen works. |

After every negative test, confirm the user's original clipboard is preserved and `uu_close_terminal` never closes a terminal that this process does not own.
