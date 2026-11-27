// Jellyfin's API as the client reads it: the fields of its answers that are
// used, and what it's sent (a device profile, a report of what's playing).

/** Who's logged in where; saved by the app between runs */
export interface Session {
  server: string
  token: string
  userId: string
  userName: string
}

/**
 * This copy of the app, as Jellyfin lists it under Devices: the app (its
 * name and version) on a device (its id, made once and kept, and its name)
 */
export interface Device {
  /** The app's name: "jellyflow"; its own settings are kept under it too */
  client: string
  version: string
  id: string
  name: string
}

export interface NameId {
  Name: string
  Id: string
}

export interface MediaStream {
  /** Video, Audio, Subtitle, … */
  Type?: string
  /** Its place in the file: what a choice of audio or subtitles names */
  Index?: number
  Codec?: string
  /** "DTS-HD MA", "Main 10", … */
  Profile?: string
  /** ISO 639-2: eng, rum, … */
  Language?: string
  /** The track's own name in the file: "Commentary", "SDH", … */
  Title?: string
  IsDefault?: boolean
  IsForced?: boolean
  IsTextSubtitleStream?: boolean
  /** For text subtitles, after PlaybackInfo: the file to fetch them from */
  DeliveryUrl?: string
  BitDepth?: number
  SampleRate?: number
  Channels?: number
  BitRate?: number
  Width?: number
  Height?: number
  /** SDR, HDR10, DOVI, … */
  VideoRangeType?: string
}

export interface MediaSource {
  Id?: string
  Container?: string
  Path?: string
  MediaStreams?: MediaStream[]
  /** After PlaybackInfo: the stream Jellyfin repackages (and converts) for this device; none when it plays the file as it is */
  TranscodingUrl?: string
  DefaultAudioStreamIndex?: number
}

/** What the user's done with an item */
export interface UserData {
  PlaybackPositionTicks?: number
  Played?: boolean
  /** ISO date: when it was last played (stopped partway or to the end) */
  LastPlayedDate?: string
  /** A series': how many of its episodes haven't been watched */
  UnplayedItemCount?: number
}

/** How to play an item on this device: Jellyfin's PlaybackInfoResponse */
export interface PlaybackInfo {
  MediaSources: MediaSource[]
  PlaySessionId?: string
  ErrorCode?: string
}

/** What this device plays, so Jellyfin can work out what to send: its DeviceProfile (the fields used) */
export interface DeviceProfile {
  Name: string
  MaxStreamingBitrate: number
  MaxStaticBitrate: number
  DirectPlayProfiles: { Type: string; Container: string; VideoCodec?: string; AudioCodec?: string }[]
  TranscodingProfiles: {
    Type: string
    Container: string
    Protocol: string
    Context: string
    VideoCodec?: string
    AudioCodec: string
    MaxAudioChannels?: string
    MinSegments?: number
    BreakOnNonKeyFrames?: boolean
  }[]
  ContainerProfiles: never[]
  CodecProfiles: {
    Type: string
    Codec: string
    Conditions: { Condition: string; Property: string; Value: string; IsRequired: boolean }[]
  }[]
  SubtitleProfiles: { Format: string; Method: string }[]
}

/** A report of what's playing, for Jellyfin to keep where it's at (and show it to other apps) */
export interface Playing {
  ItemId: string
  MediaSourceId?: string
  PlaySessionId?: string
  PositionTicks: number
  IsPaused?: boolean
  CanSeek?: boolean
  PlayMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode'
  AudioStreamIndex?: number
  SubtitleStreamIndex?: number
  EventName?: string
}

/** The fields of Jellyfin's BaseItemDto read here */
export interface Item {
  Id: string
  Name: string
  Type: string
  IsFolder?: boolean
  CollectionType?: string
  Path?: string
  ParentId?: string
  Album?: string
  AlbumId?: string
  AlbumArtist?: string
  AlbumArtists?: NameId[]
  Artists?: string[]
  ProductionYear?: number
  IndexNumber?: number
  ParentIndexNumber?: number
  RunTimeTicks?: number
  ImageTags?: Record<string, string>
  AlbumPrimaryImageTag?: string
  Genres?: string[]
  Studios?: NameId[]
  ProviderIds?: Record<string, string>
  /** Cast and crew: Actor (Role: the character), Director, Writer, Producer, Creator, … */
  People?: { Name: string; Id?: string; Type?: string; Role?: string; PrimaryImageTag?: string }[]
  /** Keywords: "princess", "castle", … */
  Tags?: string[]
  MediaSources?: MediaSource[]
  Overview?: string
  ExternalUrls?: { Name: string; Url: string }[]
  SortName?: string
  OriginalTitle?: string
  Taglines?: string[]
  /** "PG-13", "R", … */
  OfficialRating?: string
  /** Out of 10 */
  CommunityRating?: number
  BackdropImageTags?: string[]
  UserData?: UserData
  /** ISO dates: when it came into the library; a series', when an episode last did */
  DateCreated?: string
  DateLastMediaAdded?: string
  /** An episode's series and season */
  SeriesId?: string
  SeasonName?: string
  /** A series': ISO date of its last episode, and Continuing or Ended */
  EndDate?: string
  Status?: string
}

/** Jellyfin's DisplayPreferencesDto: sent back whole when saved, with the app's own settings in CustomPrefs */
export interface Preferences {
  CustomPrefs?: Record<string, string | null>
  [field: string]: unknown
}
