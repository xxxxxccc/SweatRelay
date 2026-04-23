export type {
  Activity,
  ActivityLap,
  ActivitySample,
  FileFormat,
  RawFile,
  Sport,
} from './activity/index.ts'
export type { ActivityRef, FetchedActivity, ListOptions, SourceAdapter } from './adapters/index.ts'
export {
  type CredentialStore,
  EncryptedFileCredentialStore,
  type EncryptedFileCredentialStoreOptions,
  KeyringCredentialStore,
  type KeyringCredentialStoreOptions,
  MemoryCredentialStore,
  ONELAP_ACCOUNT_KEY,
  ONELAP_PASSWORD_KEY,
  ONELAP_SESSION_KEY,
  STRAVA_CLIENT_ID_KEY,
  STRAVA_CLIENT_SECRET_KEY,
  STRAVA_TOKENS_KEY,
} from './credentials/index.ts'
export { detectFormat, type ParseFitOptions, parseFit } from './parsers/index.ts'
export {
  type SyncOutcome,
  SyncPipeline,
  type SyncPipelineOptions,
} from './pipeline/index.ts'
export { SyncedStore, type SyncedStoreOptions, type SyncRecord } from './state/index.ts'
export {
  FileWatcherTrigger,
  type FileWatcherTriggerOptions,
  ManualTrigger,
  ScheduledTrigger,
  type ScheduledTriggerOptions,
  type Trigger,
  type TriggerEvent,
  type TriggerHandler,
} from './triggers/index.ts'
export {
  type AuthorizeOptions,
  makeTokenGetter,
  type OAuthAppConfig,
  type PollOptions,
  StravaOAuth,
  type StravaTokens,
  StravaUploader,
  type StravaUploaderConfig,
  type TokenManager,
  type UploadOptions,
  type UploadResult,
} from './uploader/index.ts'
export {
  DuplicateActivityError,
  RateLimitError,
  StravaApiError,
  SweatRelayError,
  sleep,
  UploadTimeoutError,
} from './util/index.ts'
