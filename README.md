# Aetheris Messenger

Flask + Socket.IO + MySQL backend, single-page frontend served by Flask.

## Setup (Windows)
1. Create the database: `mysql -u root -p < database/schema.sql`
   (existing DB from an older version: `mysql -u root -p < database/migrate_existing.sql`)
2. `cd backend`, `python -m venv venv`, `venv\Scripts\activate`, `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and fill in DB credentials and the two secret keys.
4. `python app.py` and open http://127.0.0.1:5000

Never commit or share `backend/.env`.
