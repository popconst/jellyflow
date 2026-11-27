// Cover Flow for Svelte 5: a row of covers on a floor that glides on a tap,
// runs ever faster while a key is held and follows the trackpad, with a page
// that swings out beside the middle cover; and rows of them, Netflix style.
// Generic over the items (anything with an `id`): what a cover shows, what's
// on its page and what its keys do are the caller's, as snippets and
// callbacks.
// - Row: one row (album covers, posters). Its keys (h l H L g G, the arrows,
//   PgUp PgDn Home End) through its `key(e)`; `select`, `nudge` and `press`
//   move it too.
// - Rails: rows of posters, the one with the keys big and the rest small
//   below it, j k between them, Enter opening a page; where each row was
//   left is kept in localStorage.
// - Poster: a poster that shows once it's loaded, its title on a card till
//   then (an `art` snippet for a row of posters). Mark: a sign in a cover's
//   corner (a `badge`), sized to read the same in every row.
// - Motion: the row's motion on its own, no DOM (a terminal's Cover Flow
//   could run on it).
// Styled with CSS custom properties the page defines: --text, --text-2,
// --text-3, --accent, --accent-2, --mono, --placeholder, --glass and
// --glass-edge (src/web/app.css has jellyflow's). It names keys with
// ../keys.
//
//   <Row items={albums} url={(a, px) => coverUrl(a, px)} label={(a) => a.title} onclick={(i, middle) => …}>
//     {#snippet art(a, px)}<img src={coverUrl(a, px)} alt="" />{/snippet}
//   </Row>

export { default as Mark } from './Mark.svelte'
export { Motion } from './motion.ts'
export { default as Poster } from './Poster.svelte'
export { default as Rails, type Rail } from './Rails.svelte'
export { default as Row, FOCUS, FOLD, layout, type Geometry } from './Row.svelte'
