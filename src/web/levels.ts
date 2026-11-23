// How loud what's playing is, low to high: four levels read from its sound
// (an AnalyserNode beside the speakers, like the spectrum's), for the mark
// of the playing track to dance to.

/** The four bands (Hz): bass, low mids, high mids, treble */
const BANDS: [number, number][] = [
  [40, 160],
  [160, 640],
  [640, 2500],
  [2500, 10000],
]

/** One listener per sound source, shared by every mark */
const taps = new WeakMap<AudioNode, AnalyserNode>()

/** Listens to `source` without touching it: tuned like the spectrum, for mastered music */
export function tap(source: AudioNode): AnalyserNode {
  let analyser = taps.get(source)
  if (!analyser) {
    analyser = source.context.createAnalyser()
    analyser.fftSize = 1024
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
