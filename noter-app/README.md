# Noter

A comprehensive note-taking and task management application with cross-platform support (Web & Mobile).

## Features

- **Cross-Platform:** Available on Web (Next.js) and Mobile (React Native/Expo).
- **Real-time Sync:** Seamless synchronization between devices using WebSockets.
- **Offline Support:** Full offline capability with local database storage.
- **Rich Text Editor:** Advanced note editing with formatting support.
- **Task Management:** Kanban board, list view, and calendar view for tasks.
- **Project Organization:** Organize notes and tasks into projects and folders.
- **Security:** Password protection for sensitive notes.

## Project Structure

This is a monorepo managed with TurboRepo:

- `apps/web`: Next.js web application
- `apps/mobile`: Expo React Native mobile application
- `apps/backend`: Node.js/Express backend server
- `packages/shared`: Shared types and utilities
- `packages/ui`: Shared UI components

## Getting Started

### Prerequisites

- Node.js (LTS)
- npm or yarn
- MongoDB (for backend)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App

**Backend:**
```bash
cd apps/backend
npm run dev
```

**Web:**
```bash
cd apps/web
npm run dev
```

**Mobile:**
```bash
cd apps/mobile
npm run start
```

## Git Workflow

- `main`: Stable production code
- `dev`: Active development branch
- Feature branches: Created from `dev` (e.g., `feature/new-feature`)

## License

[MIT](LICENSE)
