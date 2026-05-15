export {
  type CorosImportResult,
  type CorosImportTask,
  type CorosRegionId,
  CorosRegionIds,
  type CorosSession,
  CorosUploader,
  type CorosUploaderConfig,
  type CorosUploadOptions,
} from './CorosUploader.ts'
export {
  type GarminActivitySummary,
  type GarminApiFetch,
  type GarminDomain,
  GarminDomains,
  type GarminImportResult,
  type GarminLoginOptions,
  type GarminLoginResult,
  type GarminMfaChallenge,
  type GarminProfile,
  type GarminSession,
  GarminUploader,
  type GarminUploaderConfig,
  type GarminUploadOptions,
  type GarminWorkoutSyncEntry,
  type GarminWorkoutSyncResult,
} from './GarminUploader.ts'
export {
  type AuthorizeOptions,
  type OAuthAppConfig,
  StravaOAuth,
  type StravaTokens,
} from './StravaOAuth.ts'
export {
  makeTokenGetter,
  type PollOptions,
  StravaUploader,
  type StravaUploaderConfig,
  type TokenManager,
  type UploadOptions,
  type UploadResult,
} from './StravaUploader.ts'
