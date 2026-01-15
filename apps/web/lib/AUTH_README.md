# NextMove Authentication System

Complete authentication system with custom login, signup, forgot password, and popup-based UI.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                       │
├─────────────────────────────────────────────────────────────────┤
│  AuthModal.tsx ──► useAuth() ──► auth-actions.ts ──► Backend    │
│  usePopUp.tsx  ──► URL params (?popup=login)                    │
│  middleware.ts ──► Route protection                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND (Node.js)                        │
├─────────────────────────────────────────────────────────────────┤
│  /api/auth/* ──► authControllers.ts ──► authRepo.ts ──► Prisma  │
│                         │                                        │
│                         ▼                                        │
│              Calls Next.js /api/internal/send-email              │
│                    (for Nodemailer)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints (Backend)

Base URL: `NEXT_PUBLIC_BASE_URL` (e.g., `http://localhost:8000`)

### POST `/api/auth/signup`

Create a new user account.

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "First name is required" |
| 400 | "Please enter a valid email address" |
| 400 | "Password must be at least 6 characters" |
| 400 | "Email already exists" |
| 500 | "Internal server error" |

---

### POST `/api/auth/login`

Login with email and password.

**Request:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "Please enter a valid email address" |
| 400 | "Password is required" |
| 400 | "No account found with this email" |
| 400 | "Incorrect password" |
| 400 | "Please use social login or reset your password" |
| 500 | "Internal server error" |

---

### POST `/api/auth/forgot-password`

Send OTP to email for password reset.

**Request:**
```json
{
  "email": "john@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent to your email"
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "Please enter a valid email address" |
| 400 | "No account found with this email" |
| 500 | "Failed to send OTP email. Please try again later." |

---

### POST `/api/auth/verify-otp`

Verify OTP and get reset token.

**Request:**
```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "resetToken": "reset_uuid_timestamp"
  }
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "OTP must be 6 digits" |
| 400 | "No account found with this email" |
| 400 | "Invalid OTP" |
| 400 | "OTP has expired" |
| 500 | "Failed to verify OTP" |

---

### POST `/api/auth/change-password`

Change password after OTP verification.

**Request:**
```json
{
  "email": "john@example.com",
  "resetToken": "reset_uuid_timestamp",
  "newPassword": "newpassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "Password must be at least 6 characters" |
| 400 | "No account found with this email" |
| 400 | "Invalid or expired reset token" |
| 500 | "Failed to change password" |

---

## Internal Email API (Next.js)

### POST `/api/internal/send-email`

Protected endpoint for sending emails via Nodemailer. Called by backend only.

**Headers:**
```
x-internal-secret: YOUR_INTERNAL_API_SECRET
```

**Request (OTP Email):**
```json
{
  "type": "otp",
  "to": "john@example.com",
  "otp": "123456",
  "name": "John"
}
```

**Request (Generic Email):**
```json
{
  "type": "generic",
  "to": "john@example.com",
  "subject": "Welcome!",
  "html": "<p>Hello World</p>"
}
```

---

## Frontend Components

### PopUp System (`usePopUp.tsx`)

URL-based modal control using query parameters.

**Popup Values:**
| Value | Description |
|-------|-------------|
| `login` | Opens login modal |
| `signup` | Opens signup modal |
| `forgot-password` | Opens forgot password flow |
| `null` | Closes modal |

**URL Parameters:**
| Param | Description |
|-------|-------------|
| `popup` | Current popup type |
| `redirect_url` | URL to redirect after successful auth |

**Usage:**
```tsx
import { usePopUp } from "@/hooks/usePopUp"

function MyComponent() {
  const { popup, setPopup, redirectUrl, redirectAfterAuth } = usePopUp()
  
  // Open login modal
  setPopup("login")
  
  // Open signup with redirect
  router.push("/?popup=signup&redirect_url=/dashboard")
  
  // After successful auth
  redirectAfterAuth()
}
```

---

### Auth Hook (`useAuth.tsx`)

Client-side authentication state management.

**Usage:**
```tsx
import { useAuth, useUser } from "@/hooks/useAuth"

function MyComponent() {
  const { signIn, signUp, signOut, getToken } = useAuth()
  const { user, isSignedIn, isLoaded } = useUser()
  
  // Sign in
  const result = await signIn(email, password)
  if (result.success) {
    // Success
  } else {
    console.error(result.error)
  }
  
  // Sign up
  const result = await signUp(name, email, password)
  
  // Sign out
  await signOut()
  
  // Get token for API calls
  const token = await getToken()
}
```

---

### Server-Side Auth (`lib/auth.ts`)

For Server Components and API routes.

**Usage:**
```tsx
import { getServerToken, getServerUser, isAuthenticated } from "@/lib/auth"

// In Server Component
export default async function Page() {
  const token = await getServerToken()
  const user = await getServerUser()
  
  if (!token) {
    redirect("/?popup=login&redirect_url=/dashboard")
  }
  
  // Fetch with token
  const res = await fetch(API_URL, {
    headers: { "Authorization": `Bearer ${token}` }
  })
}
```

---

### Middleware (`middleware.ts`)

Protects routes from unauthenticated access.

**Protected Routes:**
- `/dashboard`
- `/forum`
- `/generate`
- `/on-boarding`
- `/templates`
- `/applied`
- `/ai-chat`

If user tries to access protected route without token:
1. Redirects to `/?popup=login&redirect_url=/original-path`
2. After login, user is redirected back to original path

---

## Cookies

| Cookie | HttpOnly | Purpose | Expiry |
|--------|----------|---------|--------|
| `nextmove_auth_token` | Yes | JWT token | 7 days |
| `nextmove_user` | No | User data (for UI) | 7 days |

---

## Environment Variables

### Next.js (`apps/web/.env.local`)

```env
# Backend URL
NEXT_PUBLIC_BASE_URL=http://localhost:8000

# Internal API Secret
INTERNAL_API_SECRET=your-32-char-secret

# Email (Gmail)
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
```

### Node.js Backend (`apps/http-server/.env`)

```env
# Database
DATABASE_URL=postgresql://...

# JWT Secret (REQUIRED)
JWT_SECRET=your-jwt-secret-key

# Next.js URL (for email API)
NEXTJS_URL=http://localhost:3000

# Internal API Secret (must match Next.js)
INTERNAL_API_SECRET=your-32-char-secret
```

Generate secrets:
```bash
openssl rand -hex 32
```

---

## File Structure

```
apps/web/
├── app/
│   └── api/internal/send-email/route.ts  # Email API
├── components/modals/
│   └── AuthModal.tsx                      # Login/Signup/ForgotPassword UI
├── hooks/
│   ├── useAuth.tsx                        # Client auth hook
│   └── usePopUp.tsx                       # Popup control
├── lib/
│   ├── auth.ts                            # Server-side auth
│   ├── auth-actions.ts                    # Server actions
│   └── email.ts                           # Nodemailer
├── middleware.ts                          # Route protection
└── utils/url.ts                           # API URLs

apps/http-server/
├── src/
│   ├── controllers/authControllers.ts     # Auth logic
│   ├── repository/authRepo.ts             # Database ops
│   ├── routes/auth.ts                     # Route definitions
│   └── middleware/authenticateUser.ts     # JWT verification
```

---

## Database Schema

```prisma
model Users {
  id         String   @id @default(uuid())
  email      String   @unique
  password   String?
  firstName  String   @default("")
  lastName   String?  @default("")
  isPaid     Boolean  @default(true)  // Premium by default
  // ... other fields
}

model PasswordReset {
  id         String   @id @default(uuid())
  userId     String
  otp        String
  resetToken String?
  expiresAt  DateTime
  used       Boolean  @default(false)
  createdAt  DateTime @default(now())
  
  user Users @relation(...)
}
```

---

## Flow Diagrams

### Login Flow
```
User clicks Login
       │
       ▼
URL: /?popup=login
       │
       ▼
AuthModal renders LoginForm
       │
       ▼
User submits email/password
       │
       ▼
useAuth.signIn() called
       │
       ▼
signInAction() (Server Action)
       │
       ▼
POST /api/auth/login (Backend)
       │
       ▼
JWT token returned
       │
       ▼
Cookies set (token + user)
       │
       ▼
Page reload / redirect
```

### Forgot Password Flow
```
User clicks "Forgot Password"
       │
       ▼
Step 1: Enter Email
       │
       ▼
POST /api/auth/forgot-password
       │
       ▼
Backend calls Next.js email API
       │
       ▼
OTP sent to email
       │
       ▼
Step 2: Enter 6-digit OTP
       │
       ▼
POST /api/auth/verify-otp
       │
       ▼
resetToken returned
       │
       ▼
Step 3: Enter New Password
       │
       ▼
POST /api/auth/change-password
       │
       ▼
Password updated, redirect to login
```

---

## Validation Rules (Zod)

| Field | Rules |
|-------|-------|
| firstName | Required, 1-50 chars |
| lastName | Optional, max 50 chars |
| email | Required, valid email format |
| password | Required, 6-100 chars |
| otp | Required, exactly 6 digits |
| resetToken | Required |

---

## Security Features

1. **Password Hashing** - bcrypt with 12 rounds
2. **JWT Tokens** - 7-day expiry, signed with secret
3. **HttpOnly Cookies** - Token not accessible via JavaScript
4. **OTP Expiry** - 10 minutes
5. **Reset Token Expiry** - 5 minutes
6. **Internal API Protection** - Secret header for email API
7. **Route Protection** - Middleware blocks unauthenticated access

---

## Gmail Setup (for SMTP)

1. Enable 2-Factor Authentication in Gmail
2. Go to: Google Account → Security → App Passwords
3. Generate new app password for "Mail"
4. Use this password as `MAIL_PASS` (not your regular password)
