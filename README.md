This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## ChatCloud setup

Before using ChatCloud custom categories, least-recently-opened sorting, saved renewal reminder schedules, or scanning existing files for renewals, run [`lib/supabase/chatcloud-enhancements.sql`](./lib/supabase/chatcloud-enhancements.sql) in the Supabase SQL Editor. This migration also grants the server's service role access needed to check for and create renewals. Reminder date/time settings are saved in the user's local time, but email delivery and the scheduler are not enabled yet.

ChatCloud image/document analysis uses Gemini. Set `GEMINI_API_KEY` in `.env.local` and optionally `GEMINI_MODEL` (default: `gemini-3.8-flash`), ensure `CHATCLOUD_AI_METADATA_ONLY=false`, and restart the dev server. If the selected model is temporarily unavailable, analysis automatically retries with `gemini-flash-lite-latest`. Keep the API key server-side; do not use a `NEXT_PUBLIC_` prefix.

## Messenger setup

Run [`lib/supabase/messenger.sql`](./lib/supabase/messenger.sql) in the Supabase SQL Editor before using Messenger. It creates the private conversations/messages schema, keeps a minimal user directory synchronized from Auth, and creates a private media bucket. Users can start chats by entering another MyCloud user's exact email address; shared image, video, audio, and PDF attachments are limited to 10 MB. Media sent to “Chat with yourself” is also copied into the ChatCloud Files library under Other, where it is marked as added via Messenger and triggers a dismissible new-file notice.

## Chatbot setup

Run [`lib/supabase/chatbot.sql`](./lib/supabase/chatbot.sql) in the Supabase SQL Editor to enable private conversation history. Set the server-side `GEMINI_API_KEY` in `.env.local` (the ChatCloud AI setup above covers the optional model setting). The assistant can answer ChatCloud feature questions and use the signed-in user's file names, categories, and renewal metadata; it does not read file contents.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
