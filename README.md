# NextMoveApp 🚀

A comprehensive job application management platform that helps job seekers streamline their application process through AI-powered message generation, template management, and application tracking.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

NextMoveApp is a full-stack web application designed to simplify the job application process. It combines AI-powered message generation with template management and application tracking to help job seekers create personalized, professional communications with recruiters and employers.

### Key Benefits

- **AI-Powered Message Generation**: Create personalized messages for job applications
- **Template Management**: Store and reuse message templates
- **Application Tracking**: Keep track of all your job applications
- **Professional Communication**: Ensure consistent, professional messaging
- **User-Friendly Interface**: Modern, responsive design with dark/light theme support

## ✨ Features

### 🤖 AI Chat & Message Generation
- Interactive AI chat interface for generating personalized messages
- Support for both simple messages and email formats
- Context-aware message generation based on job role, company, and recruiter
- Real-time conversation flow with option-based selections

### 📝 Template Management
- Create, edit, and delete message templates
- Filter templates by type (Email, Message, All)
- Categorize templates for easy organization
- Template sharing and reuse functionality

### 📊 Application Tracking
- Track all job applications in one place
- View application history with company, role, and status information
- Monitor application progress and outcomes
- Export application data for record keeping

### 👤 User Management
- Secure authentication with Clerk
- User profile management
- Role-based access control
- Personalized dashboard

### 🎨 Modern UI/UX
- Responsive design for all devices
- Dark and light theme support
- Modern component library with Radix UI
- Smooth animations and transitions
- Accessibility-first design

## 🛠 Tech Stack

### Frontend
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.x
- **UI Components**: Radix UI primitives
- **Icons**: Lucide React, Tabler Icons
- **Animations**: Motion (Framer Motion)
- **Authentication**: Clerk
- **State Management**: React hooks and context

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Clerk Backend
- **AI Integration**: Google Gemini AI
- **Caching**: Redis
- **Logging**: Winston
- **Validation**: Zod schemas

### Development Tools
- **Package Manager**: pnpm
- **Monorepo**: Turborepo
- **Linting**: ESLint
- **Type Checking**: TypeScript
- **Build Tool**: Next.js with Turbopack

## 📁 Project Structure

```
NextMoveApp/
├── apps/
│   ├── web/                    # Next.js frontend application
│   │   ├── app/                # App Router pages
│   │   │   ├── ai-chat/        # AI chat interface
│   │   │   ├── applied/        # Application tracking
│   │   │   ├── on-boarding/    # User onboarding
│   │   │   └── templates/      # Template management
│   │   ├── components/         # Reusable UI components
│   │   │   ├── modals/         # Modal components
│   │   │   └── ui/             # Base UI components
│   │   ├── pages/              # Page components
│   │   └── lib/                # Utility functions
│   └── http-server/            # Express.js backend API
│       ├── src/
│       │   ├── controllers/    # Route controllers
│       │   ├── middleware/     # Express middleware
│       │   ├── repository/     # Data access layer
│       │   ├── routes/         # API routes
│       │   └── utils/          # Utility functions
│       └── dist/               # Compiled JavaScript
├── packages/
│   ├── db/                     # Prisma database package
│   ├── Types/                  # Shared TypeScript types
│   ├── eslint-config/          # ESLint configurations
│   ├── typescript-config/      # TypeScript configurations
│   └── ui/                     # Shared UI components
└── docs/                       # Documentation
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm 8+
- PostgreSQL database
- Redis server (optional, for caching)
- Clerk account (for authentication)
- Google Gemini API key (for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/NextMoveApp.git
   cd NextMoveApp
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Environment Setup**
   
   Create `.env` files in both `apps/web` and `apps/http-server`:

   **apps/web/.env.local**
   ```env
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   CLERK_SECRET_KEY=your_clerk_secret_key
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
   NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
   ```

   **apps/http-server/.env**
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/nextmoveapp"
   CLERK_SECRET_KEY=your_clerk_secret_key
   GEMINI_API_KEY=your_gemini_api_key
   REDIS_URL=redis://localhost:6379
   PORT=3001
   ```

4. **Database Setup**
   ```bash
   cd packages/db
   pnpm prisma migrate dev
   pnpm prisma generate
   ```

5. **Start Development Servers**
   
   In separate terminals:

   ```bash
   # Start backend server
   cd apps/http-server
   pnpm dev

   # Start frontend server
   cd apps/web
   pnpm dev
   ```

6. **Access the Application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/users/create-user` - Create new user
- `POST /api/users/update-user-details` - Update user profile

### Template Management
- `GET /api/templates` - Get user templates
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Message Generation
- `POST /api/generated-messages` - Generate AI message
- `GET /api/generated-messages` - Get user's generated messages

### Role Management (Admin)
- `GET /api/roles` - Get all roles
- `POST /api/roles` - Create new role
- `DELETE /api/roles` - Delete role

## 🗄 Database Schema

### Core Models

**Users**
- User authentication and profile information
- Relationships with applications, templates, and generated messages

**Templates**
- Message templates for different scenarios
- Categorized by type (Email, Message)
- User-specific templates

**GeneratedMessages**
- AI-generated messages with context
- Links to templates, roles, and companies
- User tracking and history

**Role**
- Job roles and positions
- Used for message generation context

**Company**
- Company information for applications
- Integration with message generation

### Relationships
- Users can have multiple templates, messages, and applications
- Templates can be used to generate multiple messages
- Messages are linked to specific roles and companies
- Role-based access control for admin features

## 🎨 UI Components

The application uses a comprehensive design system built on Radix UI primitives:

- **Layout**: Responsive navigation with mobile support
- **Forms**: Accessible form components with validation
- **Modals**: Flexible modal system for various interactions
- **Tables**: Data display with sorting and filtering
- **Theme**: Dark/light mode with smooth transitions

## 🔧 Development

### Code Style
- TypeScript for type safety
- ESLint for code quality
- Prettier for code formatting
- Conventional commits for version control

### Testing
- Unit tests for utilities and components
- Integration tests for API endpoints
- End-to-end tests for critical user flows

### Performance
- Next.js optimization features
- Image optimization
- Code splitting and lazy loading
- Redis caching for API responses

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed
- Follow the existing code style

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) for the amazing React framework
- [Radix UI](https://www.radix-ui.com/) for accessible component primitives
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
- [Clerk](https://clerk.com/) for authentication
- [Google Gemini](https://ai.google.dev/) for AI capabilities
- [Prisma](https://www.prisma.io/) for database management

## 📞 Support

For support, email support@nextmoveapp.com or join our Discord community.

---

**NextMoveApp** - Making job applications smarter, faster, and more effective. 🚀