# Native layout experiment

This probe creates real Ghostty splits, a tab and a second window through its
GTK action interface. It counts the controlled Bash processes and their distinct
PTYs, then moves its window to an existing workspace and back. It closes only
the Ghostty child it launched. No Voyager or global settings change.

Run from a graphical Linux login with Ghostty, Python/PyGObject and libX11:

```sh
python3 experiments/ghostty-layout.py --output "$HOME/.local/share/voyager-layout-proof"
```

Use a fresh absolute directory. Results and terminal diagnostics stay there.
The initial proof used Fedora and Ghostty 1.1.3. A second workspace is needed for
the move check; otherwise the result explicitly records that it was not tested.

The counts are process-wide in this controlled Bash-only experiment. They do not
enumerate panes per tab or establish which pane displays an agent. The GTK
actions operate on the current surface and return no new pane identifier.
Pane-specific docking, closing, task capture and layout defaults remain unproved.

References: [Ghostty's pinned GTK actions](https://github.com/ghostty-org/ghostty/blob/v1.1.3/src/apprt/gtk/Window.zig#L402),
[GIO remote actions](https://docs.gtk.org/gio/class.DBusActionGroup.html),
[EWMH workspace requests](https://specifications.freedesktop.org/wm-spec/latest/ar01s05.html).
