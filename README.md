# brusliste-backend

This is the backend for the Brusliste application, now using Supabase as the database.

## Environment Variables

Make sure to set the following environment variables in your Vercel project:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (for server-side operations)
- `CORS_ORIGIN`: The origin of your frontend application (e.g., https://brusliste.vercel.app)

## Development

1. Install dependencies: `npm install`
2. Set up environment variables in a `.env` file (do not commit this file)
3. Run the server: `npm start`

## Deployment

This project is set up for deployment on Vercel. Make sure to set the environment variables in your Vercel project settings.