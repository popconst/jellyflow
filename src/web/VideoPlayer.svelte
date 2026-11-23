<!--
  The player for films and episodes, full window, in the manner of YouTube's:
  the picture, and over it controls that fade away while it plays (moving
  the mouse or a key brings them back). At an episode's end the next one
  follows after a countdown, as on Netflix. Jellyfin sends the file's streams untouched wherever the
  browser plays them and converts only what it can't, without loss
  (core/playback.ts); the settings say which. hls.js plays the stream where
  the browser doesn't play HLS itself (all but Safari). Where it's at goes
  back to Jellyfin as it plays, so any of its apps resumes there.
-->
<script lang="ts">
  import type Hls from 'hls.js'
  import { onMount, untrack } from 'svelte'
  import { duration } from '../core/details.ts'
  import { ticks, type MediaSource as Source, type Playing } from '../core/jellyfin.ts'
  import {
    audioTracks,
    conversion,
    deviceProfile,
    pickAudio,
    pickSubtitles,
    playMethod,
    subtitleTracks,
    type Track,
  } from '../core/playback.ts'
  import { linesAt, parseVtt, type Cue } from '../core/vtt.ts'
  import { coverColours, seekFill, stops } from './palette.ts'
  import { app, store, stored } from './state.svelte.ts'
  import { browserCaps, nativeHls, watch, type Showing } from './watch.svelte.ts'

  interface Props {
    /** The film or episode, with its streams, and the second to start at */
    showing: Showing
    /** Around the player: what goes full screen, so it stays so from one episode to the next (each is a new player) */
    theatre: HTMLElement | undefined
  }
  let { showing, theatre }: Props = $props()
  /** A new one is a new player */
  const film = untrack(() => showing)

  /** Where it's at goes to Jellyfin this often while it plays (ms) */
  const REPORT_EVERY = 10_000
  /** The controls fade this long after the last mouse move or key (ms) */
  const IDLE = 2600
  /** At an episode's end, the next one starts after this many seconds */
  const COUNTDOWN = 8
  const VOLUME = 'jellyflow.volume'

  const client = app.client
  const caps = browserCaps()
  const profile = deviceProfile(caps)
  /** The file's streams, before Jellyfin has said how it sends them (a new film is a new player) */
  const file: Source = film.item.MediaSources?.[0] ?? {}

  let video = $state<HTMLVideoElement>()
  let bar = $state<HTMLElement>()
  let hls: Hls | undefined
  /** hls.js (the full build: the light one fails on Dolby Vision streams' SUPPLEMENTAL-CODECS), fetched while Jellyfin prepares the stream */
  const hlsJs = nativeHls() ? undefined : import('hls.js')
  let source = $state.raw<Source | undefined>()
  /** Jellyfin's id for this playing, for its reports */
  let session: string | undefined

  const audios = $derived(audioTracks(source ?? file))
  const subs = $derived(subtitleTracks(source ?? file))
  let audio = $state.raw<Track | undefined>()
  let subtitles = $state.raw<Track | undefined>()
  /** The subtitles last on, for c to bring back */
  let lastSubtitles: Track | undefined
  let cues = $state.raw<Cue[]>([])

  let time = $state(film.start)
  /** The time captions are drawn at: every frame, not every timeupdate */
  let now = $state(0)
  let length = $state(film.seconds)
  let buffered = $state(0)
  let paused = $state(true)
  let waiting = $state(true)
  /** The picture has shown: captions wait for it */
  let shown = $state(false)
  /** A word over the picture for a moment (the track chosen) */
  let note = $state<string | undefined>()
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  let volume = $state(stored<number>(VOLUME) ?? 1)
  let muted = $state(false)
  let fullscreen = $state(document.fullscreenElement !== null)
  let controls = $state(true)
  let menu = $state(false)
  let error = $state<string | undefined>()
  /** Where the pointer is over the seek bar, and where a drag is taking it */
  let hoverAt = $state<number | undefined>()
  let scrubAt = $state<number | undefined>()
  /** A moment's sign in the middle: what a key or click just did */
  let flash = $state<{ icon: string; key: number } | undefined>()
  let colours = $state<string[]>([])
  /** At an episode's end: the next one, and the seconds before it starts */
  let upNext = $state<{ showing: Showing; count: number } | undefined>()
  let countdown: ReturnType<typeof setInterval> | undefined

  let started = false
  let reportedAt = 0
  let stopped = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const at = $derived(scrubAt ?? time)
  const lines = $derived(shown && subtitles && !subtitles.burnIn ? linesAt(cues, now) : [])
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

  // captions follow the picture frame by frame while there are any
  $effect(() => {
    if (!cues.length || paused || !video) {
      now = video?.currentTime ?? time
      return
    }
    const v = video
    const tick = () => {
      now = v.currentTime
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  /** Asks Jellyfin how to play it with the audio (and burned-in subtitles) chosen, and plays from `at` */
  async function load(at: number): Promise<void> {
    if (!client || !video) return
    error = undefined
    waiting = true
    const before = session
    try {
      const info = await client.playbackInfo(film.id, profile, {
        mediaSourceId: file.Id,
        audio: audio?.index,
        subtitles: subtitles?.burnIn ? subtitles.index : undefined,
      })
      const s = info.MediaSources[0]
      if (info.ErrorCode || !s) throw new Error(info.ErrorCode === 'NotAllowed' ? 'Jellyfin doesn’t allow this user to play it' : `Jellyfin can’t stream it here (${info.ErrorCode ?? 'no stream'})`)
      source = s
      session = info.PlaySessionId
    } catch (e) {
      waiting = false
      error = e instanceof Error ? e.message : String(e)
      return
    }
    // the stream it replaces (another audio track) is ended on the server
    if (before) endStream(before)
    // the subtitles come while the picture starts (once: another audio track keeps them)
    if (!cues.length) void loadCues(subtitles)
    const url = source.TranscodingUrl ? client.resolve(source.TranscodingUrl) : client.videoUrl(film.id, source.Id)
    started = false
    await attach(url, at, Boolean(source.TranscodingUrl))
  }

  async function attach(url: string, at: number, isHls: boolean): Promise<void> {
    const v = video
    if (!v) return
    hls?.destroy()
    hls = undefined
    if (!isHls || nativeHls()) {
      v.src = url
      if (at > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = at), { once: true })
    } else {
      const { default: HlsJs } = await (hlsJs ?? import('hls.js'))
      const h = new HlsJs({
        startPosition: at,
        // Jellyfin starts its packager on a seek: the first piece can take a while
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 30_000,
            maxLoadTimeMs: 120_000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          },
        },
        maxBufferLength: 60,
        backBufferLength: 90,
        debug: import.meta.env.DEV && localStorage.getItem('jellyflow.debug') === 'hls',
      })
      let recovered = false
      h.on(HlsJs.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true
          h.recoverMediaError()
          return
        }
        waiting = false
        error = `Couldn’t play it: ${data.details}`
      })
      h.loadSource(url)
      h.attachMedia(v)
      hls = h
    }
    void v.play().catch(() => (paused = true))
  }

  /** Ends a stream Jellyfin is packaging, when it's no longer wanted */
  function endStream(id: string): void {
    void client?.endStream(id).catch(() => undefined)
  }

  function playing(event?: string): Playing {
    return {
      ItemId: film.id,
      MediaSourceId: source?.Id,
      PlaySessionId: session,
      PositionTicks: ticks(video?.currentTime ?? time),
      IsPaused: video?.paused ?? true,
      CanSeek: true,
      PlayMethod: source ? playMethod(source) : 'DirectStream',
      AudioStreamIndex: audio?.index,
      SubtitleStreamIndex: subtitles?.index ?? -1,
      ...(event ? { EventName: event } : {}),
    }
  }

  function report(event: 'start' | 'progress', name?: string): void {
    reportedAt = Date.now()
    void client?.report(event, playing(name)).catch(() => undefined)
  }

  /** The end of watching: Jellyfin keeps where it was (and ends its stream); the film's or series' page shows it */
  function stop(keepalive = false): void {
    if (stopped || !client) return
    stopped = true
    clearInterval(countdown)
    const last = playing()
    if (started) {
      void client
        .report('stopped', last, keepalive)
        .catch(() => undefined)
        .then(() => film.stopped?.())
    } else if (session) endStream(session)
    hls?.destroy()
    hls = undefined
    if (video) {
      video.removeAttribute('src')
      video.load()
    }
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
    const stream = source.MediaStreams?.find((s) => s.Index === t.index)
    try {
      const parsed = parseVtt(await client.subtitles(film.id, source.Id, t.index, stream?.DeliveryUrl))
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

  // -- the seek bar

  function timeAt(e: PointerEvent): number {
    const r = bar?.getBoundingClientRect()
    if (!r || !r.width) return 0
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length
  }

  function scrubStart(e: PointerEvent): void {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    scrubAt = timeAt(e)
  }

  function scrubMove(e: PointerEvent): void {
    hoverAt = timeAt(e)
    if (scrubAt !== undefined) scrubAt = hoverAt
  }

  function scrubEnd(): void {
    if (scrubAt === undefined) return
    seek(scrubAt)
    scrubAt = undefined
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
      const session = navigator.mediaSession
      session.metadata = new MediaMetadata({
        title: film.name,
        artist: film.from,
        artwork: film.poster.tag ? [{ src: client.posterUrl(film.poster.id, film.poster.tag, 512), sizes: '512x768', type: 'image/jpeg' }] : [],
      })
      session.setActionHandler('play', () => void video?.play())
      session.setActionHandler('pause', () => video?.pause())
      session.setActionHandler('seekbackward', () => skip(-10))
      session.setActionHandler('seekforward', () => skip(10))
      session.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime))
      session.setActionHandler('nexttrack', film.next ? () => void next(true) : null)
      session.setActionHandler('previoustrack', null)
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
    if (started && !v.paused && Date.now() - reportedAt > REPORT_EVERY) report('progress', 'timeupdate')
  }

  function onplaying(): void {
    waiting = false
    shown = true
    if (!started) {
      started = true
      report('start')
    }
  }

  function onpause(): void {
    paused = true
    controls = true
    if (started) report('progress', 'pause')
  }

  function onplay(): void {
    paused = false
    poke()
    if (started) report('progress', 'unpause')
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
  <!-- the captions are drawn below, from Jellyfin's subtitles -->
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
    onerror={() => !error && video?.error && (error = `Couldn’t play it (${video.error.message || `error ${video.error.code}`})`)}
  ></video>

  {#if lines.length}
    <div class="captions" class:raised={controls}>
      {#each lines as line, i (i)}<span>{line}</span>{/each}
    </div>
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
    {@const n = upNext.showing}
    <div class="upnext" role="status">
      {#if n.poster.tag && client}
        <img src={client.posterUrl(n.poster.id, n.poster.tag, 200)} alt="" />
      {/if}
      <div class="what">
        <div class="when">Next episode in {upNext.count}</div>
        <div class="title">{n.sub}</div>
        <div class="buttons">
          <button class="play" onclick={() => upNext && goOn(upNext.showing)}>▶ Play now <kbd>Enter</kbd></button>
          <button onclick={close}>Back <kbd>Esc</kbd></button>
        </div>
      </div>
    </div>
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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="seek"
      bind:this={bar}
      onpointerdown={scrubStart}
      onpointermove={scrubMove}
      onpointerup={scrubEnd}
      onpointercancel={() => (scrubAt = undefined)}
      onpointerleave={() => (hoverAt = undefined)}
      role="slider"
      tabindex="-1"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(length)}
      aria-valuenow={Math.round(at)}
    >
      <div class="rail">
        <div class="buffered" style:width="{(buffered / length) * 100}%"></div>
        <div class="done" style:width="{(at / length) * 100}%" style:background={fill}></div>
      </div>
      <div class="knob" style:left="{(at / length) * 100}%"></div>
      {#if hoverAt !== undefined}
        <div class="tip" style:left="{(hoverAt / length) * 100}%">{duration(hoverAt)}</div>
      {/if}
    </div>

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
      <button class="icon" class:on={menu} onclick={() => (menu = !menu)} title="Audio and subtitles (s)" aria-label="Settings">
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
    <div class="menu">
      <section>
        <h4>Audio</h4>
        {#each audios as t (t.index)}
          <button class:chosen={t.index === audio?.index} onclick={() => chooseAudio(t)}>{t.label}</button>
        {/each}
      </section>
      <section>
        <h4>Subtitles</h4>
        <button class:chosen={!subtitles} onclick={() => chooseSubtitles(undefined)}>Off</button>
        {#each subs as t (t.index)}
          <button class:chosen={t.index === subtitles?.index} onclick={() => chooseSubtitles(t)}>{t.label}</button>
        {/each}
      </section>
      {#if sent}
        <!-- what Jellyfin does to the file for this browser -->
        <p class="sent">
          Picture: {sent.video ? 're-encoded' : 'as in the file'} ·
          Sound: {sent.audio
            ? `${audio?.label.split(' · ').pop() ?? 'converted'} → ${sent.audio.toUpperCase()}${sent.audio === 'flac' || sent.audio === 'alac' ? ' (lossless)' : ''}`
            : 'as in the file'}
        </p>
      {/if}
    </div>
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
  .seek {
    position: relative;
    height: 18px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }
  .rail {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.22);
    overflow: hidden;
    transition: height 120ms;
  }
  .seek:hover .rail {
    height: 6px;
  }
  .buffered,
  .done {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
  }
  .buffered {
    background: rgb(255 255 255 / 0.35);
  }
  .done {
    background: linear-gradient(90deg, var(--accent-2), var(--accent));
  }
  .knob {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
    transform: scale(0);
    transition: transform 120ms;
  }
  .seek:hover .knob {
    transform: scale(1);
  }
  .tip {
    position: absolute;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 6px;
    font: 12px var(--mono);
    background: var(--glass), rgb(20 20 24 / 0.85);
    box-shadow: var(--glass-edge);
    pointer-events: none;
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
  /* -- captions: white on a dark box, like YouTube's; up a little while the controls show */
  .captions {
    position: absolute;
    left: 50%;
    bottom: 6%;
    z-index: 1;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: max-content;
    max-width: 86%;
    text-align: center;
    transition: bottom 250ms;
    pointer-events: none;
  }
  .captions.raised {
    bottom: calc(6% + 70px);
  }
  .captions span {
    padding: 1px 8px;
    font-size: clamp(18px, 2.6vw, 36px);
    line-height: 1.3;
    color: #fff;
    background: rgb(8 8 8 / 0.75);
    border-radius: 3px;
    white-space: pre-wrap;
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
  /* the next episode, after a countdown: Netflix's corner card, on glass */
  .upnext {
    position: absolute;
    right: 24px;
    bottom: 110px;
    z-index: 4;
    display: flex;
    gap: 14px;
    width: min(420px, calc(100% - 48px));
    padding: 12px;
    border-radius: 12px;
    background: var(--glass), rgb(18 18 22 / 0.92);
    box-shadow: var(--glass-edge);
  }
  .upnext img {
    width: 72px;
    height: 108px;
    object-fit: cover;
    border-radius: 4px;
    flex: none;
  }
  .upnext .what {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .upnext .when {
    font-size: 13px;
    color: var(--text-2);
  }
  .upnext .title {
    font-size: 16px;
    font-weight: 650;
  }
  .upnext .buttons {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .upnext button {
    border: 0;
    border-radius: 999px;
    padding: 6px 14px;
    background: rgb(255 255 255 / 0.12);
    color: var(--text);
    font-size: 14px;
  }
  .upnext button.play {
    background: var(--text);
    color: #000;
    font-weight: 650;
  }
  .upnext kbd {
    font-size: 11px;
    margin-left: 4px;
    opacity: 0.7;
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
  /* -- the settings: audio and subtitles, on glass above the controls */
  .menu {
    position: absolute;
    right: 18px;
    bottom: 84px;
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    width: min(620px, calc(100% - 36px));
    max-height: min(60vh, 520px);
    padding: 12px;
    overflow-y: auto;
    border-radius: 12px;
    background: var(--glass), rgb(18 18 22 / 0.9);
    box-shadow: var(--glass-edge);
    backdrop-filter: blur(12px);
  }
  .menu section {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  h4 {
    margin: 2px 8px 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }
  .menu button {
    text-align: left;
    border: 0;
    border-radius: 6px;
    padding: 6px 8px 6px 26px;
    background: none;
    color: var(--text);
    position: relative;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu button:hover {
    background: var(--hover);
  }
  .menu button.chosen {
    background: var(--glass);
    box-shadow: var(--glass-edge);
    font-weight: 600;
  }
  .menu button.chosen::before {
    content: '✓';
    position: absolute;
    left: 9px;
  }
  .sent {
    flex: 1 1 100%;
    margin: 4px 8px 0;
    font-size: 12px;
    color: var(--text-2);
  }
</style>
