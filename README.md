# jellyflow

Your [Jellyfin](https://jellyfin.org) music library, flipped through by album
cover (Cover Flow) or walked folder by folder with album art, all from the
keyboard with vim keys. It's the web sibling of
[coverflow](https://github.com/popconst/coverflow), the MPD terminal app,
with the same keys. A terminal version comes next and shares the same core.

```
   ┌──┐ ┌────┐ ┌──────────┐ ┌────┐ ┌──┐
   │  │ │    │ │          │ │    │ │  │
   └──┘ │    │ │  cover   │ │    │ └──┘
        └────┘ │          │ └────┘
               └──────────┘
               Discovery
           Daft Punk · 2001
```

## Run

```sh
npm install
cp .env.example .env.local     # set VITE_JELLYFIN_URL to your server
npm run dev                    # http://localhost:5173, reloads as you edit
```

As a local web service:

```sh
npm run build && npm start     # http://127.0.0.1:4173 (HOST, PORT to change)
```

Log in with your Jellyfin user. The page talks to Jellyfin straight from the
browser, so it needs Jellyfin's CORS to allow it. Jellyfin allows any origin
by default. Audio is streamed as the files are (FLAC, MP3, …), not transcoded.

## Keys

`?` shows them all. `Tab` switches between the two views.

**Everywhere:**
- `Space`: play / pause.
- `<` `>`: previous / next track.
- `c`: go to what's playing. `o` goes back to where you were before (`o` again: back to what's playing).
- `a`: add to the queue.
- `i`: the album's details. With the details open, `d`, `w` and `m` open Discogs, Wikipedia and MusicBrainz.

**Cover Flow** (coverflow's keys):

| Key | |
|---|---|
| `h` `l` / `←` `→` | previous / next album; also scroll, or click a side cover |
| `H` `L` / PgUp PgDn | 10 back / forward |
| `g` `G` | first / last |
| `/` | filter by artist, album, year or track title (words in any order). `Enter` browses the matches, `Esc` cancels, `Ctrl-U` clears |
| `Esc` | the whole library again, at the same album |
| `Enter` | open the album: like a gatefold sleeve, a page with its tracks swings out beside the cover, with the spectrum of what's playing on the floor under it. On it, `j` / `k` move, `Enter` plays from there (so `Enter` `Enter` plays the album), and `k` on the first track or `Esc` folds it shut |

**Folders** (like ranger or yazi: the folder above, this folder, and a preview):

| Key | |
|---|---|
| `j` `k` | down / up; counts work (`5j`) |
| `l` `h` | open / back up (also `-` and `Backspace`) |
| `Enter` | play the album, or the folder from this track |
| `gg` `G` `12G` | first / last / item 12 |
| `Ctrl-d` `Ctrl-u` `Ctrl-f` `Ctrl-b` | half page / page, down and up |
| `H` `M` `L` `zz` | top / middle / bottom of the screen; centre the cursor |
| `/` `n` `N` | find in this folder; next and previous match |
| `~` | the top folder |

## How it works

- **Albums** are Jellyfin's music albums, minus anything under a `Playlists/`
  folder. They're sorted by year, oldest first (albums without a year last),
  then by title, then by artist.
  - The year is the album folder's `YYYY - ` prefix when it has one (the
    original release), else the tags' year. The details show both when they
    differ.
- **Search by track** uses every track title in the library. The titles load
  in the background after the albums, a page at a time.
- **Live reload:** Jellyfin's websocket says when the library changed. Once
  the changes settle, both views read it again and stay where they were.
- **Folders** are the library's folders as they are on disk. A folder without
  a cover of its own shows up to four covers of the albums under it.
- **Playing** happens in the browser: a queue, auto-advance, and the OS's
  media keys and now-playing panel. The sound goes through Web Audio
  untouched, which the spectrum
  ([audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer),
  1/24-octave bands coloured from the cover) listens to.
- **Remembered across reloads:** what's playing (the queue, the track and the
  second it was at), where Cover Flow was (album and filter), and the open
  folder with its cursor. If something was playing, it plays on and Cover
  Flow opens its album with the cursor on the track. The browser has to allow
  the site to start sound by itself (in Brave: site settings → Autoplay →
  Allow); if it doesn't, it plays on at the first key press or click.

## Layout

```
src/core/   Jellyfin client, albums + search, details, vim key sequences.
            No DOM: plain TypeScript that Node runs as it is (type stripping),
            shared with the terminal app. `tsconfig.core.json` checks it
            without DOM types.
src/web/    Svelte 5 app: Coverflow, Folders, player.
server.ts   serves dist/ (no dependencies)
```

The one runtime dependency is audioMotion-analyzer (the spectrum, with no
dependencies of its own); Svelte, Vite and TypeScript are dev dependencies.

## Next: the terminal

The terminal app will be `src/tui/`, run by Node, on the same `src/core`. Its
pieces:
- the same views drawn with kitty graphics (like coverflow);
- playback through `mpv --input-ipc-server` on `Jellyfin.streamUrl()`.

## Develop

```sh
npm run check    # svelte-check (strict) + the core without the DOM
npm test         # node --test on src/core
```

## License

MIT
