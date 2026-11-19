<script lang="ts">
  import { app, defaultServer } from './state.svelte.ts'

  let server = $state(defaultServer)
  let user = $state('')
  let password = $state('')
  let error = $state('')
  let busy = $state(false)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      await app.login(server, user, password)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }
</script>

<form class="login" onsubmit={submit}>
  <h1>jelly<span>flow</span></h1>
  <label>Jellyfin server <input bind:value={server} placeholder="https://jellyfin.example.com" required /></label>
  <!-- svelte-ignore a11y_autofocus -->
  <label>User <input bind:value={user} autocomplete="username" autofocus required /></label>
  <label>Password <input bind:value={password} type="password" autocomplete="current-password" /></label>
  <button disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
  {#if error}<p class="error">{error}</p>{/if}
</form>

<style>
  .login {
    width: min(360px, calc(100% - 32px));
    margin: 18vh auto 0;
    display: grid;
    gap: 14px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 34px;
    letter-spacing: -0.02em;
  }
  h1 span {
    color: var(--accent);
  }
  label {
    display: grid;
    gap: 4px;
    color: var(--text-2);
    font-size: 13px;
  }
  input {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 9px 11px;
    font-size: 15px;
  }
  input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
  button {
    margin-top: 6px;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    border: 0;
    border-radius: 6px;
    padding: 10px;
  }
  .error {
    color: #ff8a8a;
    margin: 0;
  }
</style>
