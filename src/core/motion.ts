// The row's motion: where it is (a fractional album index) and where it's
// heading.
// - A tap moves one album, with a short spring glide; quick taps stack up.
// - Holding a key runs: as soon as the keyboard starts repeating (or after
//   a moment, without key repeat), the row slides at a speed you can follow
//   that keeps doubling, directly, with no lag behind the key.
// - Letting go slows down smoothly (no jolt) onto an album a little ahead:
//   the faster it was going, the further, up to MAX_COAST.

/** The whole motion's pace: 1 as first tuned, 1.1 is 10% slower */
const SLOW = 1.1
/** Without key repeat, a press this long (s) becomes a run */
const HOLD = 0.25
/** A run's speed: from this many albums a second (slow enough to see them slide)… */
const START_SPEED = 14 / SLOW
/** …doubling every this many seconds… */
const DOUBLING = 0.45 * SLOW
/** …up to this */
const TOP_SPEED = 300 / SLOW
/** How quickly a run gets up to speed (1/s) */
const PICKUP = 12 / SLOW
/** After a run, it slides on for this long at the speed it had, s… */
const COAST = 0.08 * SLOW
/** …but at most this many albums */
const MAX_COAST = 6
/** The spring's stiffness (rad/s) for taps and jumps: critically damped, so no bounce */
const OMEGA = 24 / SLOW
/** Stopping after a run never takes longer than this stiffness allows */
const MIN_OMEGA = 10 / SLOW
/** A jump further than this many albums starts this far away, so it still glides */
const FAR = 12

export class Motion {
  /** Where the row is: the album in the middle, fractional while moving */
  pos = 0
  /** Where it's heading */
  target = 0
  /** Albums a second */
  velocity = 0
  private held: -1 | 0 | 1 = 0
  private heldFor = 0
  private running = false
  private runFor = 0
  /** The spring's stiffness now: OMEGA, or what a stop after a run needs */
  private omega = OMEGA

  /** At `index` at once: no glide (a new filter, a reload) */
  snap(index: number): void {
    this.pos = this.target = index
    this.velocity = 0
    this.held = 0
    this.running = false
  }

  /** A key down: one album that way */
  press(dir: -1 | 1): void {
    if (this.held === dir) return
    this.held = dir
    this.heldFor = 0
    this.running = false
    this.omega = OMEGA
    this.target = Math.round(this.target) + dir
  }

  /** The keyboard repeats the key: run */
  repeat(dir: -1 | 1): void {
    if (this.held !== dir) this.press(dir)
    this.run()
  }

  /** That key up: slide on a little and stop on an album */
  release(dir: -1 | 1): void {
    if (this.held !== dir) return
    if (this.running) {
      const speed = Math.abs(this.velocity)
      const ahead = this.pos + dir * Math.min(MAX_COAST, speed * COAST)
      this.target = dir > 0 ? Math.ceil(ahead) : Math.floor(ahead)
      // a spring that brings this speed to rest exactly there: the speed
      // decays smoothly, with no jolt and no overshoot
      const room = Math.abs(this.target - this.pos)
      this.omega = room > 0.01 ? Math.max(MIN_OMEGA, speed / room) : OMEGA
    }
    this.held = 0
    this.running = false
  }

  /** Every key up (the window lost focus mid-run) */
  releaseAll(): void {
    if (this.held) this.release(this.held)
  }

  /** `n` albums on from where it's heading (H / L) */
  nudge(n: number): void {
    this.omega = OMEGA
    this.target = Math.round(this.target) + n
  }

  /** To `index`, gliding the last stretch if it's far */
  jump(index: number): void {
    const far = index - this.pos
    if (Math.abs(far) > FAR) {
      this.pos = index - Math.sign(far) * FAR
      this.velocity = 0
    }
    this.held = 0
    this.running = false
    this.omega = OMEGA
    this.target = index
  }

  /** Scrolling: the target moves by any fraction; `settle` rounds it once scrolling stops */
  scroll(albums: number): void {
    this.held = 0
    this.running = false
    this.omega = OMEGA
    this.target += albums
  }

  settle(): void {
    this.target = Math.round(this.target)
  }

  get moving(): boolean {
    return this.held !== 0 || this.pos !== this.target || this.velocity !== 0
  }

  /** Moves it on by `dt` seconds within `count` albums; false once it's at rest */
  tick(dt: number, count: number): boolean {
    const last = Math.max(0, count - 1)
    // small steps keep the spring steady whatever the frame rate
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240)
      if (this.held && !this.running) {
        this.heldFor += h
        if (this.heldFor > HOLD) this.run()
      }
      if (this.running) {
        this.runFor += h
        const speed = this.held * Math.min(TOP_SPEED, START_SPEED * 2 ** (this.runFor / DOUBLING))
        this.velocity += (speed - this.velocity) * Math.min(1, h * PICKUP)
        this.pos = Math.max(0, Math.min(this.pos + this.velocity * h, last))
        if (this.pos === 0 || this.pos === last) this.velocity = 0
        this.target = this.pos
        continue
      }
      this.target = Math.max(0, Math.min(this.target, last))
      const w = this.omega
      const pull = w * w * (this.target - this.pos) - 2 * w * this.velocity
      this.velocity += pull * h
      this.pos += this.velocity * h
    }
    if (!this.held && Math.abs(this.target - this.pos) < 0.002 && Math.abs(this.velocity) < 0.05) {
      this.pos = this.target
      this.velocity = 0
      return false
    }
    return true
  }

  private run(): void {
    if (this.running) return
    this.running = true
    this.runFor = 0
    // carry on from the tap's glide, at least at the starting speed
    this.velocity = this.held * Math.max(Math.abs(this.velocity), START_SPEED)
  }
}
