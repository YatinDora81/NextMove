<!-- Sample Clerk webhook payloads, kept to document the shape `user.service.ts` parses.
     All identifiers, emails and names are redacted placeholders - do not paste real
     webhook output back into this file. -->

create user response

2025-10-14 13:18:48 [info]: [ CLERK WEBHOOK ] Event
New user created: {
  backup_code_enabled: false,
  banned: false,
  create_organization_enabled: true,
  created_at: 1760428128258,
  delete_self_enabled: true,
  email_addresses: [
    {
      created_at: 1760428128246,
      email_address: 'jane.doe@example.com',
      id: 'idn_000000000000000000000000',
      linked_to: [Array],
      matches_sso_connection: false,
      object: 'email_address',
      reserved: false,
      updated_at: 1760428128265,
      verification: [Object]
    }
  ],
  enterprise_accounts: [],
  external_accounts: [
    {
      approved_scopes: 'email https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid profile',
      avatar_url: 'https://lh3.googleusercontent.com/<redacted>',
      created_at: 1760428128240,
      email_address: 'jane.doe@example.com',
      external_account_id: 'eac_000000000000000000000000',
      family_name: 'Dora',
      first_name: 'Redacted',
      given_name: 'Yatin',
      google_id: '000000000000000000000',
      id: 'idn_000000000000000000000000',
      identification_id: 'idn_000000000000000000000000',
      image_url: 'https://img.clerk.com/<redacted>',
      label: null,
      last_name: 'Redacted',
      object: 'google_account',
      picture: 'https://lh3.googleusercontent.com/<redacted>',
      provider: 'oauth_google',
      provider_user_id: '000000000000000000000',
      public_metadata: {},
      updated_at: 1760428128240,
      username: null,
      verification: [Object]
    }
  ],
  external_id: null,
  first_name: 'Redacted',
  has_image: true,
  id: 'user_000000000000000000000000',
  image_url: 'https://img.clerk.com/<redacted>',
  last_active_at: 1760428128257,
  last_name: 'Redacted',
  last_sign_in_at: null,
  legal_accepted_at: null,
  locale: null,
  locked: false,
  lockout_expires_in_seconds: null,
  mfa_disabled_at: null,
  mfa_enabled_at: null,
  object: 'user',
  passkeys: [],
  password_enabled: false,
  phone_numbers: [],
  primary_email_address_id: 'idn_000000000000000000000000',
  primary_phone_number_id: null,
  primary_web3_wallet_id: null,
  private_metadata: {},
  profile_image_url: 'https://images.clerk.dev/oauth_google/img_000000000000000000000000',    
  public_metadata: {},
  saml_accounts: [],
  totp_enabled: false,
  two_factor_enabled: false,
  unsafe_metadata: {},
  updated_at: 1760428128277,
  username: null,
  verification_attempts_remaining: 100,
  web3_wallets: []
}




update user

2025-10-14 13:21:16 [info]: [ CLERK WEBHOOK ] Event
User updated: {
  backup_code_enabled: false,
  banned: false,
  create_organization_enabled: true,
  created_at: 1760428128258,
  delete_self_enabled: true,
  email_addresses: [
    {
      created_at: 1760428128246,
      email_address: 'jane.doe@example.com',
      id: 'idn_000000000000000000000000',
      linked_to: [Array],
      matches_sso_connection: false,
      object: 'email_address',
      reserved: false,
      updated_at: 1760428128265,
      verification: [Object]
    }
  ],
  enterprise_accounts: [],
  external_accounts: [
    {
      approved_scopes: 'email https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid profile',
      avatar_url: 'https://lh3.googleusercontent.com/<redacted>',
      created_at: 1760428128240,
      email_address: 'jane.doe@example.com',
      external_account_id: 'eac_000000000000000000000000',
      family_name: 'Dora',
      first_name: 'Redacted',
      given_name: 'Yatin',
      google_id: '000000000000000000000',
      id: 'idn_000000000000000000000000',
      identification_id: 'idn_000000000000000000000000',
      image_url: 'https://img.clerk.com/<redacted>',
      label: null,
      last_name: 'Redacted',
      object: 'google_account',
      picture: 'https://lh3.googleusercontent.com/<redacted>',
      provider: 'oauth_google',
      provider_user_id: '000000000000000000000',
      public_metadata: {},
      updated_at: 1760428128240,
      username: null,
      verification: [Object]
    }
  ],
  external_id: null,
  first_name: 'Redacted',
  has_image: false,
  id: 'user_000000000000000000000000',
  image_url: 'https://img.clerk.com/<redacted>',  
  last_active_at: 1760428128257,
  last_name: 'Redacted',
  last_sign_in_at: 1760428128269,
  legal_accepted_at: null,
  locale: null,
  locked: false,
  lockout_expires_in_seconds: null,
  mfa_disabled_at: null,
  mfa_enabled_at: null,
  object: 'user',
  passkeys: [],
  password_enabled: false,
  phone_numbers: [],
  primary_email_address_id: 'idn_000000000000000000000000',
  primary_phone_number_id: null,
  primary_web3_wallet_id: null,
  private_metadata: {},
  profile_image_url: 'https://www.gravatar.com/avatar?d=mp',
  public_metadata: {},
  saml_accounts: [],
  totp_enabled: false,
  two_factor_enabled: false,
  unsafe_metadata: {},
  updated_at: 1760428275924,
  username: null,
  verification_attempts_remaining: 100,
  web3_wallets: []
}



delete user 
[info]: [ CLERK WEBHOOK ] Event
User deleted: {
  deleted: true,
  id: 'user_000000000000000000000000',
  object: 'user'
}