export const BASE_API = process.env.NEXT_PUBLIC_BASE_URL;

export const AUTH_SIGNUP = `${BASE_API}/api/auth/signup`;
export const AUTH_LOGIN = `${BASE_API}/api/auth/login`;
export const AUTH_FORGOT_PASSWORD = `${BASE_API}/api/auth/forgot-password`;
export const AUTH_VERIFY_OTP = `${BASE_API}/api/auth/verify-otp`;
export const AUTH_CHANGE_PASSWORD = `${BASE_API}/api/auth/change-password`;

export const GET_ALL_ROLES = `${BASE_API}/api/roles/get-roles`;
export const GET_ALL_TEMPLATES = `${BASE_API}/api/templates/get-templates`;
export const DELETE_TEMPLATE = `${BASE_API}/api/templates/delete-template`;
export const GENERATE_MESSAGE = `${BASE_API}/api/generate/generate-message`;
export const GET_GENERATED_MESSAGES = `${BASE_API}/api/generate/get-generated-messages`;
export const GET_ALL_ROOMS = `${BASE_API}/api/chat/get-all-chats`;
export const ADD_NEW_MESSAGE = `${BASE_API}/api/chat/create-chat`;
export const UPDATE_USER_DETAILS = `${BASE_API}/api/users/update-user-details`
export const ADD_NEW_TEMPLATE = `${BASE_API}/api/templates/add-template`;
export const UPDATE_TEMPLATE = `${BASE_API}/api/templates/update-template`;
export const GET_PREDEFINED_TEMPLATES = `${BASE_API}/api/templates/get-common-templates`;
export const GENERATE_AI_TEMPLATE = `${BASE_API}/api/templates/ai-generate-template`;

export const AI_KEYS            = `${BASE_API}/api/ai-keys`;
export const AI_KEY_TEST        = (id: string) => `${BASE_API}/api/ai-keys/${id}/test`;
export const AI_KEY_DELETE      = (id: string) => `${BASE_API}/api/ai-keys/${id}`;

export const DEVICE_PAIR_CODE   = `${BASE_API}/api/devices/pair-code`;
export const DEVICES            = `${BASE_API}/api/devices`;
export const DEVICE_REVOKE      = (id: string) => `${BASE_API}/api/devices/${id}`;
export const JOB_APPLICATIONS   = `${BASE_API}/api/job-applications`;

export const SYNC_PROFILE       = `${BASE_API}/api/sync/profile`;
export const SYNC_MAPPINGS      = `${BASE_API}/api/sync/mappings`;
