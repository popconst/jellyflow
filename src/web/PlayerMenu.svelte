<!--
  The player's settings, on glass above its controls: the picture's quality,
  the audio track, the subtitles; and what Jellyfin does to the file for this
  browser (the picture as it is or re-encoded, the sound as it is or
  converted, and to what).
-->
<script lang="ts">
  import type { Conversion, Quality, Track } from '../core/playback.ts'

  interface Props {
    qualities: Quality[]
    quality: Quality
    audios: Track[]
    audio: Track | undefined
    subtitles: Track[]
    chosen: Track | undefined
    /** What Jellyfin does to the file, once it's said */
    sent: Conversion | undefined
    onquality: (q: Quality) => void
    onaudio: (t: Track) => void
    onsubtitles: (t: Track | undefined) => void
  }
  let { qualities, quality, audios, audio, subtitles, chosen, sent, onquality, onaudio, onsubtitles }: Props = $props()

  /** "Dolby Digital+ 5.1 → FLAC (lossless)" */
  const sound = $derived(
    sent?.audio
      ? `${audio?.label.split(' · ').pop() ?? 'converted'} → ${sent.audio.toUpperCase()}${sent.audio === 'flac' || sent.audio === 'alac' ? ' (lossless)' : ''}`
      : 'as in the file',
  )
</script>

<div class="menu">
  <section>
    <h4>Quality</h4>
    {#each qualities as q (q.label)}
      <button class:chosen={q === quality} onclick={() => onquality(q)}>{q.label}</button>
    {/each}
  </section>
  <section>
    <h4>Audio</h4>
    {#each audios as t (t.index)}
      <button class:chosen={t.index === audio?.index} onclick={() => onaudio(t)}>{t.label}</button>
    {/each}
  </section>
  <section>
    <h4>Subtitles</h4>
    <button class:chosen={!chosen} onclick={() => onsubtitles(undefined)}>Off</button>
    {#each subtitles as t (t.index)}
      <button class:chosen={t.index === chosen?.index} onclick={() => onsubtitles(t)}>{t.label}</button>
    {/each}
  </section>
  {#if sent}
    <p class="sent">
      Picture: {sent.video ? `re-encoded${quality.height ? ` to ${quality.label}` : ''}` : 'as in the file'} · Sound: {sound}
    </p>
  {/if}
</div>

<style>
  .menu {
    position: absolute;
    right: 18px;
    bottom: 84px;
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    width: min(860px, calc(100% - 36px));
    max-height: min(60vh, 520px);
    padding: 12px;
    overflow-y: auto;
    border-radius: 12px;
    background: var(--glass), rgb(18 18 22 / 0.9);
    box-shadow: var(--glass-edge);
    backdrop-filter: blur(12px);
  }
  .menu section {
    flex: 1 1 220px;
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
