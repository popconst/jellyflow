// A Jellyfin client for the browser and Node: plain fetch and URLs, no
// dependencies. What it covers:
// - client.ts: logging in, the libraries and their items, images, how to
//   play an item (PlaybackInfo) and telling Jellyfin where playing is, the
//   app's own settings, live events (the websocket's URL).
// - profiles.ts: the device profiles that have Jellyfin send a file as it
//   is wherever the browser plays it, and convert only what it can't; the
//   picture qualities for a slow link; what Jellyfin did to the file.
// - tracks.ts: a film's audio and subtitle tracks, named plainly, and the
//   ones to start with.
// - items.ts: ticks, dates, folder names, natural order.
// - browser.ts (imported on its own, it needs the DOM): what this browser
//   plays, for the profiles.
//
//   const device = { client: 'myapp', version: '1.0.0', id: crypto.randomUUID(), name: 'myapp web' }
//   const jellyfin = new Jellyfin(await login('jelly.example.com', user, password, device), device)
//   const films = await jellyfin.movies(libraryId)
//   const info = await jellyfin.playbackInfo(films[0].Id, deviceProfile(browserCaps(), 'myapp'))

export * from './client.ts'
export * from './items.ts'
export * from './profiles.ts'
export * from './tracks.ts'
export type * from './types.ts'
