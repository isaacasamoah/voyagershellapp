# Install the Fedora prototype

Extract the Linux archive, open its folder in a terminal, then run:

```sh
./install.sh
```

Open **Voyager Shell** from Applications. The installer uses your account only,
without root access or login startup. It includes Electron and the compiled Rust
service and window helper. Rust, Node and the source checkout are not needed to
run it. Ghostty is required for Vessels. Install and authenticate Codex separately
to use agent Vessels and Voyager's private chat/voice conversation. Missing Codex
does not prevent the service or Bash Vessels from running.

Opening the app starts or reconnects to the service. Closing the panel leaves work
running. Use each Vessel's menu to stop/remove it, then the panel's small menu to
stop the service. No restart or migration of an already running service is forced.

The app lives under `~/.local/share/voyagershell-app`, with a desktop entry and
astronaut icon under the same XDG data directory. A versioned installation keeps
previous builds; `current` selects the newly installed one. State remains separate
under `~/.local/share/voyagershell`. Removing application files does not erase it
or stop an already running service.

## Build from source

On Linux, with Rust, Node 24 and a C linker:

```sh
npm --prefix desktop ci
node desktop/node_modules/electron/install.js
npm --prefix desktop run package:linux
```

Commit the source first. The package contains the pinned Electron runtime,
runtime source/assets and release-mode Rust binaries. Its archive name and
`build.json` record the source commit; a SHA-256 file accompanies the archive.
Build output stays in `desktop/out` and is not committed.

This follows Electron's [manual bundle layout](https://www.electronjs.org/docs/latest/tutorial/application-distribution).
Installed binaries are located through
[`process.resourcesPath`](https://www.electronjs.org/docs/latest/api/process#processresourcespath-readonly).
The installer runs with Electron's
[bundled Node runtime](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node).
The app itself retains sandboxed, isolated renderers.

This is a local Fedora prototype, not a signed or published cross-platform
release. Dedicated Ghostty XWayland windows remain the supported terminal surface.
Other Linux distributions, macOS, Windows and automatic updates need separate proof.
The next Fedora delivery format is a single RPM installed with `dnf`; the archive
and account-local installer are the initial bundle proof.
