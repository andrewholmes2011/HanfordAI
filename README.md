# Study Desk: setup

Layout of this repo (andrewholmes2011/chatgptforstudents):

    index.html, style.css, app.js   -> the website (GitHub Pages)
    worker.js, wrangler.toml        -> the backend (Cloudflare Worker)
    accounts.example.json           -> EXAMPLE ONLY. Never commit real passwords.

## 1. Backend (Cloudflare)
1. Cloudflare dashboard > Workers & Pages > your Worker `chatgpt4students` > Edit code.
2. Replace the code with the contents of `worker.js` and Deploy.
3. Settings > Bindings: confirm `AI` (Workers AI) and `CHATS` (KV namespace).
4. Settings > Variables and Secrets:
   - Add a **Secret** named `ACCOUNTS` with your accounts as JSON (see accounts.example.json).
   - Add a **Variable** named `ALLOWED_ORIGIN` = https://andrewholmes2011.github.io
5. Deploy again.

Any username starting with `TEACHER_` is a teacher. Everyone else is a student.
To add or change accounts, edit the `ACCOUNTS` secret and save.

## 2. Frontend (GitHub Pages)
1. Put index.html, style.css, app.js in the repo root (or /docs).
2. Repo > Settings > Pages > Deploy from branch > main > / (root).
3. Site goes live at https://andrewholmes2011.github.io/chatgptforstudents/
