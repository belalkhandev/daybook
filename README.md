# Daybook

A Linux desktop app for daily tasks and notes. Offline-first: everything lives in a local SQLite file, and only the optional AI drafting calls the network, and only when you trigger it.

Built with Tauri 2 (Rust) and React 18 + TypeScript + Vite.

## Install

Download `Daybook_0.1.0_amd64.deb` from the `release/` folder and install it:

```bash
sudo apt install ./release/Daybook_0.1.0_amd64.deb
```

Daybook then appears in the application menu. Targets Ubuntu 22.04+ and Debian 12+ (WebKitGTK 4.1).

## Data and secrets

- Database: `~/.local/share/daybook/daybook.db` (SQLite, WAL mode)
- The AI API key is stored in the system keyring (GNOME Keyring or KWallet) and is only read by the Rust side. It never reaches the frontend, logs or config files.

## Build from source

On Ubuntu 22.04 or newer:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config patchelf
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install
npm run tauri build -- --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/Daybook_0.1.0_amd64.deb
```

Run the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml`.

To regenerate icons from `app-icon.png`: `npm run tauri icon ./app-icon.png`.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl K | Search tasks and notes |
| Ctrl N | Quick add |
| Ctrl Shift N | Write with AI |
| Ctrl Enter | Save, send or generate in the focused modal or composer |
| Tab (in Quick add title) | Switch Task and Note |
| Esc | Close modal or popover, cancel AI generation |
| Ctrl 1 / 2 / 3 / 4 | Today, Upcoming, Notes, Calendar |
| Space (task window) | Start or pause the timer when focus is not in a text field |

Quick add understands `#tag`, `!high`/`!med`/`!low`, times (`4pm`, `16:00`, `at 4`), days (`today`, `tomorrow`, weekday names, `next week`) and durations (`2h`, `90m`, `1h30m`). Example: `Call Rafi at 4pm #work !high`.

## Notes

- If the window is blank on some NVIDIA drivers, Daybook already sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the webview starts. Set it to `0` yourself to override.
- Reduce transparency (Settings, General) swaps the glass cards for solid ones on slow GPUs.
- Upcoming and Calendar are placeholders until they are designed.
- The design reference files live in `design/`. The `src/dev/mock.ts` file is only used by `npm run dev` in a plain browser and is removed from production builds.
