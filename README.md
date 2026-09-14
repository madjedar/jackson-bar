# Jackson Bar — Professional Barista & Cocktail Academy Platform

A state-of-the-art web platform for Jackson Bar Academy, featuring interactive video hero showcase, course enrollment management, curriculum breakdown, and a password-protected live Admin CMS.

## 🌟 Key Features
- **Hero Video Showcase**: Dynamic macOS-style floating video player with audio toggle and seamless looped background video.
- **Interactive Course Showcases**: High-resolution image showcases with zoom interactions for *Classic Bar* and *Extra Barman* courses.
- **Online Enrollment Formular**: Fast student registration with validation and WhatsApp confirmation ticket.
- **Protected Admin Portal (`yacine123`)**:
  - **Orders Management**: Search, filter by status, WhatsApp one-click direct chat, direct call, and KPIs.
  - **Site Media & Video Manager**: Upload or delete top hero video and course images with instant live updates.
- **Multi-Tier Database & Storage**:
  - `server.py` local disk database (`assets/uploads/`, `data/media.json`, `data/orders.json`).
  - Browser `IndexedDB` (`JacksonBarDB`) for unlimited offline media storage.
  - HTML5 Canvas client-side image auto-compression.

## 🚀 Running Locally
Simply double-click:
```
start_website.bat
```
Or start manually via Python:
```bash
python server.py 8000
```
Then navigate to `http://localhost:8000/`.

## 🌐 Deploying to Vercel
1. Push this repository to GitHub.
2. Go to [Vercel Dashboard](https://vercel.com/new).
3. Import the repository and click **Deploy**.
4. The platform will be live globally on a custom HTTPS domain.
