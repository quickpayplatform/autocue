# AutoQue

AutoQue is a theatre-grade workflow for remote lighting cue submission, validation, and operator approval for ETC Eos consoles.

## Backend setup

- Set environment variables from `backend/.env.example`.
- Run migrations:

```bash
cd backend
npm install
npm run migrate
```

- Seed a theatre + admin:

```bash
THEATRE_NAME="Main Stage" THEATRE_TIMEZONE="America/New_York" \
ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="change_me" \
npm run seed:theatre
```

## Render notes

- Ensure `OSC_IP` and `OSC_IP_WHITELIST` are set to the venue bridge VPN IP.
- Run `npm run migrate` in the Render shell after deploy.

## Frontend (MVP pages)

- `/login` for auth
- `/theatre/rig-builder` for rig setup
- `/client/session` for AutoQue session creation
