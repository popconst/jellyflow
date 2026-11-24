<!--
  The player for films and episodes, full window, in the manner of YouTube's:
  the picture, and over it controls that fade away while it plays (moving
  the mouse or a key brings them back). The stream is stream.svelte.ts';
  the seek bar, the subtitles, the settings and the next episode's card are
  their own components. At an episode's end the next one follows after a
  countdown, as on Netflix.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { duration } from '../core/details.ts'
  import type { MediaSource as Source } from '../core/jellyfin.ts'
  import {
    audioTracks,
    conversion,
    deviceProfile,
    pickAudio,
    pickQuality,
    pickSubtitles,
    qualities,
    subtitleTracks,
    type Quality,
    type Track,
  } from '../core/playback.ts'
  import { parseVtt, type Cue } from '../core/vtt.ts'
  import { browserCaps } from './caps.ts'
  import Captions from './Captions.svelte'
  import { coverColours, seekFill, stops } from './palette.ts'
  import PlayerMenu from './PlayerMenu.svelte'
  import SeekBar from './SeekBar.svelte'
  import { app, store, stored } from './state.svelte.ts'
  import { Stream } from './stream.svelte.ts'
  import UpNext from './UpNext.svelte'
  import { watch, type Showing } from './watch.svelte.ts'

  interface Props {
    /** The film or episode, with its streams, and the second to start at */
    showing: Showing
    /** Around the player: what goes full screen, so it stays so from one episode to the next (each is a new player) */
    theatre: HTMLElement | undefined
  }
  let { showing, theatre }: Props = $props()
  /** A new one is a new player */
  const film = untrack(() => showing)

  /** The controls fade this long after the last mouse move or key (ms) */
  const IDLE = 2600
  /** At an episode's end, the next one starts after this many seconds */
  const COUNTDOWN = 8
  const VOLUME = 'jellyflow.volume'

  const client = app.client
  const caps = browserCaps()
  /** The file's streams, before Jellyfin has said how it sends them */
  const file: Source = film.item.MediaSources?.[0] ?? {}
  /** The picture qualities to choose from: the file as it is, or Jellyfin re-encoding it to a bitrate */
  const choices = qualities(file)

  let video = $state<HTMLVideoElement>()
  const stream = client
    ? new Stream(client, film.id, {
        mediaSourceId: file.Id,
        where: () => ({
          seconds: video?.currentTime ?? time,
          paused: video?.paused ?? true,
          audio: audio?.index,
          subtitles: subtitles?.index,
        }),
      })
    : undefined
  const source = $derived(stream?.source)

  const audios = $derived(audioTracks(source ?? file))
  const subs = $derived(subtitleTracks(source ?? file))
  let audio = $state.raw<Track | undefined>()
  let subtitles = $state.raw<Track | undefined>()
  /** The subtitles last on, for c to bring back */
  let lastSubtitles: Track | undefined
  let cues = $state.raw<Cue[]>([])
  let quality = $state.raw(pickQuality(choices, watch.quality))

  let time = $state(film.start)
  let length = $state(film.seconds)
  let buffered = $state(0)
  let paused = $state(true)
  let waiting = $state(true)
  /** The picture has shown: subtitles wait for it */
  let shown = $state(false)
  /** A word over the picture for a moment (the track chosen) */
  let note = $state<string | undefined>()
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  let volume = $state(stored<number>(VOLUME) ?? 1)
  let muted = $state(false)
  let fullscreen = $state(document.fullscreenElement !== null)
  let controls = $state(true)
  let menu = $state(false)
  /** Why it can't play */
  const error = $derived(stream?.error ?? (client ? undefined : 'Not logged in'))
  /** Where a drag on the seek bar is taking it */
  let scrubAt = $state<number | undefined>()
  /** A moment's sign in the middle: what a key or click just did */
  let flash = $state<{ icon: string; key: number } | undefined>()
  let colours = $state<string[]>([])
  /** At an episode's end: the next one, and the seconds before it starts */
  let upNext = $state<{ showing: Showing; count: number } | undefined>()
  let countdown: ReturnType<typeof setInterval> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  const at = $derived(scrubAt ?? time)
  const fill = $derived(seekFill(colours))
  const sent = $derived(source ? conversion(source) : undefined)

  // the seek bar in the poster's colours, like the music's in the album's
  $effect(() => {
    let live = true
    void coverColours(film.poster.id, film.poster.tag).then((c) => {
      if (live && c.length) colours = stops(c)
    })
    return () => {
      live = false
    }
  })

  /** Asks Jellyfin for it with the quality, audio and picture subtitles chosen, and plays from `at` */
  async function load(at: number): Promise<void> {
    if (!stream || !video) return
    waiting = true
    const ok = await stream.open(video, at, {
      profile: deviceProfile(caps, quality),
      audio: audio?.index,
      burnIn: subtitles?.burnIn ? subtitles.index : undefined,
    })
    if (!ok) {
      waiting = false
      return
    }
    void video?.play().catch(() => undefined)
    // the subtitles, once (another audio track keeps them)
    if (!cues.length) void loadCues(subtitles)
  }

  /** The end of watching: Jellyfin keeps where it was; the film's or series' page shows it */
  function stop(keepalive = false): void {
    clearInterval(countdown)
    stream?.stop(video, film.stopped, keepalive)
  }

  function close(): void {
    stop()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    watch.close()
  }

  /** On to the next episode: now (N, the button), or after a countdown (at the end) */
  async function next(now: boolean): Promise<void> {
    if (!film.next) return
    clearInterval(countdown)
    let following: Showing | undefined
    try {
      following = await film.next()
    } catch {
      following = undefined
    }
    if (!following) {
      if (now) say('That was the last episode')
      else close()
      return
    }
    if (now) return goOn(following)
    upNext = { showing: following, count: COUNTDOWN }
    controls = true
    countdown = setInterval(() => {
      if (!upNext) return clearInterval(countdown)
      if (upNext.count <= 1) goOn(upNext.showing)
      else upNext = { ...upNext, count: upNext.count - 1 }
    }, 1000)
  }

  /** The next one in a new player; full screen stays (it's the theatre's, around the player) */
  function goOn(following: Showing): void {
    stop()
    watch.open(following)
  }

  function ended(): void {
    if (film.next) void next(false)
    else close()
  }

  async function loadCues(t: Track | undefined): Promise<void> {
    cues = []
    if (!t || t.burnIn || !client || !source) return
    const s = source.MediaStreams?.find((x) => x.Index === t.index)
    try {
      const parsed = parseVtt(await client.subtitles(film.id, source.Id, t.index, s?.DeliveryUrl))
      if (subtitles === t) cues = parsed
    } catch {
      say('Couldn’t load those subtitles')
    }
  }

  // -- choices

  function chooseAudio(t: Track): void {
    menu = false
    watch.prefer({ audio: t.language })
    if (t.index === audio?.index) return
    audio = t
    void load(video?.currentTime ?? time)
    say(t.label)
  }

  /** A picture quality: the stream asked for again, from where it is */
  function chooseQuality(q: Quality): void {
    menu = false
    watch.preferQuality(q === choices[0] ? undefined : q.bitrate)
    if (q === quality) return
    quality = q
    void load(video?.currentTime ?? time)
    say(q.label)
  }

  function chooseSubtitles(t: Track | undefined): void {
    menu = false
    watch.prefer({ subtitles: t?.language })
    if (t?.index === subtitles?.index) return
    const burned = Boolean(subtitles?.burnIn || t?.burnIn)
    subtitles = t
    if (t) lastSubtitles = t
    // picture subtitles are part of the stream: a new one, re-encoded (or no longer)
    if (burned) void load(video?.currentTime ?? time)
    void loadCues(t)
    say(t ? t.label : 'Subtitles off')
  }

  /** c: subtitles off, or back on (the last ones, else in the audio's language, else the first) */
  function toggleSubtitles(): void {
    if (subtitles) return chooseSubtitles(undefined)
    const text = subs.filter((t) => !t.burnIn)
    chooseSubtitles(
      lastSubtitles ??
        pickSubtitles(text, { subtitles: watch.preference.subtitles ?? audio?.language }, audio?.language) ??
        text.find((t) => !t.forced) ??
        text[0],
    )
  }

  /** a: the next audio track */
  function nextAudio(): void {
    if (audios.length < 2) return
    const at = audios.findIndex((t) => t.index === audio?.index)
    const next = audios[(at + 1) % audios.length]
    if (next) chooseAudio(next)
  }

  // -- playing

  function toggle(): void {
    const v = video
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
    sign(v.paused ? 'play' : 'pause')
  }

  function seek(t: number): void {
    const v = video
    if (!v) return
    v.currentTime = Math.max(0, Math.min(length - 1, t))
    time = v.currentTime
  }

  function skip(by: number): void {
    seek((video?.currentTime ?? time) + by)
    sign(by < 0 ? 'back' : 'ahead')
  }

  function setVolume(v: number): void {
    volume = Math.max(0, Math.min(1, v))
    muted = volume === 0
    store(VOLUME, volume)
  }

  async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => undefined)
    if (theatre?.requestFullscreen) return theatre.requestFullscreen().catch(() => undefined)
    // iPhone: only the video itself goes full screen (with the system's controls)
    ;(video as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | undefined)?.webkitEnterFullscreen?.()
  }

  async function pictureInPicture(): Promise<void> {
    const v = video
    if (!v) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => undefined)
    else if (document.pictureInPictureEnabled) await v.requestPictureInPicture().catch(() => undefined)
  }

  /** A moment's sign in the middle */
  function sign(icon: string): void {
    clearTimeout(flashTimer)
    flash = { icon, key: (flash?.key ?? 0) + 1 }
    flashTimer = setTimeout(() => (flash = undefined), 600)
  }

  /** A word over the picture for a moment (the app's status line is under the player) */
  function say(message: string): void {
    clearTimeout(noteTimer)
    note = message
    noteTimer = setTimeout(() => (note = undefined), 2500)
  }

  /** Controls on, and off again once nothing happens for a while (unless paused, or in use) */
  function poke(): void {
    controls = true
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!paused && !menu && scrubAt === undefined) controls = false
    }, IDLE)
  }

  // -- keys: all of them are the player's while it's open

  function onkeydown(e: KeyboardEvent): void {
    // nothing behind the player hears a key (the browser's own shortcuts still work)
    e.stopImmediatePropagation()
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // the countdown to the next episode: Enter starts it now, Esc goes back
    if (upNext && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault()
      if (e.key === 'Enter') goOn(upNext.showing)
      else close()
      return
    }
    let handled = true
    switch (e.key) {
      case ' ':
      case 'k':
        toggle()
        break
      case 'j':
        skip(-10)
        break
      case 'l':
        skip(10)
        break
      case 'ArrowLeft':
        skip(-5)
        break
      case 'ArrowRight':
        skip(5)
        break
      case 'ArrowUp':
        setVolume(volume + 0.05)
        break
      case 'ArrowDown':
        setVolume(volume - 0.05)
        break
      case 'm':
        muted = !muted
        break
      case 'f':
        void toggleFullscreen()
        break
      case 'c':
        toggleSubtitles()
        break
      case 'a':
        nextAudio()
        break
      case 's':
        menu = !menu
        break
      case 'Home':
        seek(0)
        break
      case 'End':
        seek(length - 10)
        break
      case 'Escape':
        if (menu) menu = false
        else close()
        break
      case 'q':
        close()
        break
      case 'N':
        void next(true)
        break
      default:
        if (/^[0-9]$/.test(e.key)) seek((length * Number(e.key)) / 10)
        else handled = false
    }
    if (handled) {
      e.preventDefault()
      poke()
    }
  }

  onMount(() => {
    // the keys, the media keys and the tab are the film's (watch.svelte.ts has stopped the music)
    audio = pickAudio(audioTracks(file), watch.preference)
    subtitles = pickSubtitles(subtitleTracks(file), watch.preference, audio?.language)
    lastSubtitles = subtitles
    void load(film.start)
    poke()

    document.title = `${film.name} · jellyflow`
    if ('mediaSession' in navigator && client) {
      const media = navigator.mediaSession
      media.metadata = new MediaMetadata({
        title: film.name,
        artist: film.from,
        artwork: film.poster.tag ? [{ src: client.posterUrl(film.poster.id, film.poster.tag, 512), sizes: '512x768', type: 'image/jpeg' }] : [],
      })
      media.setActionHandler('play', () => void video?.play())
      media.setActionHandler('pause', () => video?.pause())
      media.setActionHandler('seekbackward', () => skip(-10))
      media.setActionHandler('seekforward', () => skip(10))
      media.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime))
      media.setActionHandler('nexttrack', film.next ? () => void next(true) : null)
      media.setActionHandler('previoustrack', null)
    }

    const onFullscreen = () => (fullscreen = document.fullscreenElement !== null && document.fullscreenElement === theatre)
    const onPageHide = () => stop(true)
    addEventListener('keydown', onkeydown, true)
    addEventListener('pagehide', onPageHide)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      removeEventListener('keydown', onkeydown, true)
      removeEventListener('pagehide', onPageHide)
      document.removeEventListener('fullscreenchange', onFullscreen)
      clearTimeout(idleTimer)
      clearTimeout(flashTimer)
      clearTimeout(noteTimer)
      stop()
    }
  })

  // -- the video's events

  function ontimeupdate(): void {
    const v = video
    if (!v) return
    time = v.currentTime
    const r = v.buffered
    for (let i = 0; i < r.length; i++) {
      if (r.start(i) <= v.currentTime + 0.5 && r.end(i) >= v.currentTime) buffered = r.end(i)
    }
    if (!v.paused) stream?.progress('timeupdate')
  }

  function onplaying(): void {
    waiting = false
    shown = true
    stream?.started()
  }

  function onpause(): void {
    paused = true
    controls = true
    stream?.progress('pause')
  }

  function onplay(): void {
    paused = false
    poke()
    stream?.progress('unpause')
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="watch"
  class:idle={!controls}
  onpointermove={(e) => e.pointerType === 'mouse' && poke()}
  role="dialog"
  tabindex="-1"
  aria-label={film.name}
>
  <!-- the subtitles are drawn over it (Captions), from Jellyfin's -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    bind:volume
    bind:muted
    crossorigin="anonymous"
    playsinline
    onclick={toggle}
    ondblclick={() => void toggleFullscreen()}
    {ontimeupdate}
    ondurationchange={() => video && Number.isFinite(video.duration) && (length = video.duration)}
    {onplaying}
    onwaiting={() => (waiting = true)}
    oncanplay={() => (waiting = false)}
    {onpause}
    {onplay}
    onended={ended}
  ></video>

  {#if shown && subtitles && !subtitles.burnIn}
    <Captions {video} {cues} {paused} raised={controls} />
  {/if}

  {#if waiting && !error}<div class="spinner" aria-label="Loading"></div>{/if}

  {#if note}<div class="note">{note}</div>{/if}


  {#if flash}
    {#key flash.key}
      <div class="flash" aria-hidden="true">
        {#if flash.icon === 'play'}<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {:else if flash.icon === 'pause'}<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {:else if flash.icon === 'back'}<span>−10</span>
        {:else}<span>+10</span>{/if}
      </div>
    {/key}
  {/if}

  {#if upNext}
    <UpNext next={upNext.showing} count={upNext.count} onplay={() => upNext && goOn(upNext.showing)} onback={close} />
  {/if}

  {#if error}
    <div class="error">
      <p>{error}</p>
      <button onclick={close}>Back</button>
    </div>
  {/if}

  <header class="top">
    <button class="icon" onclick={close} title="Back (Esc)" aria-label="Back">
      <svg viewBox="0 0 24 24"><path d="M15.5 4 7.5 12l8 8 1.4-1.4L10.3 12l6.6-6.6z" /></svg>
    </button>
    <div class="name">
      <div class="title">{film.title}</div>
      <div class="sub">{film.sub}</div>
    </div>
  </header>

  <footer class="bottom">
    <SeekBar {time} {length} {buffered} {fill} bind:scrubAt onseek={seek} />

    <div class="buttons">
      <button class="icon" onclick={toggle} title={paused ? 'Play (k)' : 'Pause (k)'} aria-label={paused ? 'Play' : 'Pause'}>
        {#if paused}<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {:else}<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>{/if}
      </button>
      <button class="icon" onclick={() => skip(-10)} title="10 s back (j)" aria-label="10 seconds back">
        <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" /><text x="12" y="16.5" text-anchor="middle">10</text></svg>
      </button>
      <button class="icon" onclick={() => skip(10)} title="10 s ahead (l)" aria-label="10 seconds ahead">
        <svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z" /><text x="12" y="16.5" text-anchor="middle">10</text></svg>
      </button>
      <div class="volume">
        <button class="icon" onclick={() => (muted = !muted)} title="Mute (m)" aria-label={muted ? 'Unmute' : 'Mute'}>
          {#if muted || volume === 0}<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" /></svg>
          {:else}<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>{/if}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          oninput={(e) => setVolume(Number(e.currentTarget.value))}
          aria-label="Volume"
        />
      </div>
      <div class="time">{duration(at)} <span>/ {duration(length)}</span></div>
      <div class="spacer"></div>
      {#if film.next}
        <button class="icon" onclick={() => void next(true)} title="Next episode (N)" aria-label="Next episode">
          <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" /></svg>
        </button>
      {/if}
      <button
        class="icon"
        class:on={subtitles !== undefined}
        onclick={toggleSubtitles}
        title="Subtitles (c)"
        aria-label="Subtitles"
        disabled={!subs.length}
      >
        <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z" /></svg>
      </button>
      <button class="icon" class:on={menu} onclick={() => (menu = !menu)} title="Quality, audio and subtitles (s)" aria-label="Settings">
        <svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
      </button>
      {#if document.pictureInPictureEnabled}
        <button class="icon" onclick={() => void pictureInPicture()} title="Picture in picture" aria-label="Picture in picture">
          <svg viewBox="0 0 24 24"><path d="M19 11h-8v6h8zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 0H3V5h18z" /></svg>
        </button>
      {/if}
      <button class="icon" onclick={() => void toggleFullscreen()} title="Full screen (f)" aria-label="Full screen">
        {#if fullscreen}<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z" /></svg>
        {:else}<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" /></svg>{/if}
      </button>
    </div>
  </footer>

  {#if menu}
    <PlayerMenu
      qualities={choices}
      {quality}
      {audios}
      {audio}
      subtitles={subs}
      chosen={subtitles}
      {sent}
      onquality={chooseQuality}
      onaudio={chooseAudio}
      onsubtitles={chooseSubtitles}
    />
  {/if}
</div>

<style>
  .watch {
    position: absolute;
    inset: 0;
    background: #000;
    overflow: hidden;
    user-select: none;
  }
  .watch.idle {
    cursor: none;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  /* -- the controls: over the picture, on a shade, fading away while it plays */
  .top,
  .bottom {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    transition: opacity 250ms;
  }
  .idle .top,
  .idle .bottom {
    opacity: 0;
    pointer-events: none;
  }
  .top {
    top: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px 40px;
    background: linear-gradient(to bottom, rgb(0 0 0 / 0.7), transparent);
  }
  .name .title {
    font-size: 18px;
    font-weight: 650;
    text-shadow: 0 1px 6px #000;
  }
  .name .sub {
    font-size: 13px;
    color: var(--text-2);
  }
  .bottom {
    bottom: 0;
    padding: 40px 18px 10px;
    background: linear-gradient(to top, rgb(0 0 0 / 0.8), rgb(0 0 0 / 0.35) 60%, transparent);
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
  }
  .spacer {
    flex: 1;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text);
  }
  .icon:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .icon:disabled {
    opacity: 0.4;
  }
  .icon svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.5));
  }
  .icon text {
    font: 700 7px var(--font);
    fill: currentColor;
  }
  /* on: the subtitles, the settings: underlined like YouTube's */
  .icon.on {
    box-shadow: inset 0 -2px 0 var(--text);
    border-radius: 6px;
  }
  .volume {
    display: flex;
    align-items: center;
  }
  .volume input {
    width: 0;
    opacity: 0;
    transition:
      width 150ms,
      opacity 150ms;
    accent-color: #fff;
  }
  .volume:hover input,
  .volume:focus-within input {
    width: 80px;
    opacity: 1;
    margin-right: 6px;
  }
  .time {
    font: 14px var(--mono);
    font-variant-numeric: tabular-nums;
    padding: 0 8px;
    text-shadow: 0 1px 3px #000;
  }
  .time span {
    color: var(--text-2);
  }
  /* -- in the middle: loading, and what a key just did */
  .spinner {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 56px;
    height: 56px;
    margin: -28px;
    border-radius: 50%;
    border: 4px solid rgb(255 255 255 / 0.2);
    border-top-color: #fff;
    animation: spin 900ms linear infinite;
    pointer-events: none;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .flash {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 72px;
    height: 72px;
    margin: -36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    pointer-events: none;
    animation: flash 600ms ease-out forwards;
  }
  .flash svg {
    width: 36px;
    height: 36px;
    fill: #fff;
  }
  .flash span {
    font: 700 18px var(--font);
  }
  @keyframes flash {
    from {
      opacity: 1;
      transform: scale(0.8);
    }
    to {
      opacity: 0;
      transform: scale(1.3);
    }
  }
  .note {
    position: absolute;
    top: 72px;
    left: 50%;
    z-index: 3;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 14px;
    background: var(--glass), rgb(20 20 24 / 0.85);
    box-shadow: var(--glass-edge);
    pointer-events: none;
  }
  .error {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    max-width: min(520px, 90%);
    padding: 18px 22px;
    border-radius: 12px;
    text-align: center;
    background: var(--glass), rgb(20 20 24 / 0.9);
    box-shadow: var(--glass-edge);
  }
  .error button {
    border: 0;
    border-radius: 999px;
    padding: 6px 18px;
    background: var(--text);
    color: #000;
    font-weight: 600;
  }
</style>
