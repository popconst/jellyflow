// How loud what's playing is, low to high: twelve levels read from its
// sound (an AnalyserNode beside the speakers, like the spectrum's), for the
// mark of the playing track to dance to.

/** How many bands: each two thirds of an octave, from the bass up */
export const BAND_COUNT = 12
const LOWEST_HZ = 40
const HIGHEST_HZ = 10_000

/** The bands (Hz), evenly spread over the octaves between the lowest and the highest */
const STEP = (HIGHEST_HZ / LOWEST_HZ) ** (1 / BAND_COUNT)
const BANDS: [number, number][] = Array.from({ length: BAND_COUNT }, (_, i) => [LOWEST_HZ * STEP ** i, LOWEST_HZ * STEP ** (i + 1)])

/** One listener per sound source, shared by every mark */
const taps = new WeakMap<AudioNode, AnalyserNode>()

/** Listens to `source` without touching it: tuned like the spectrum, for mastered music */
export function tap(source: AudioNode): AnalyserNode {
  let analyser = taps.get(source)
  if (!analyser) {
    analyser = source.context.createAnalyser()
    // fine enough for the bass's narrow bands (a bin is some 23 Hz)
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.6
    analyser.minDecibels = -80
    analyser.maxDecibels = -18
    source.connect(analyser)
    taps.set(source, analyser)
  }
  return analyser
}

/** Each band's level now, 0 to 1: its loudest bin */
export function levels(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number[] {
  analyser.getByteFrequencyData(data)
  const hz = analyser.context.sampleRate / analyser.fftSize
  return BANDS.map(([low, high]) => {
    let peak = 0
    for (let i = Math.max(1, Math.floor(low / hz)); i <= Math.ceil(high / hz) && i < data.length; i++) peak = Math.max(peak, data[i] ?? 0)
    return peak / 255
  })
}
