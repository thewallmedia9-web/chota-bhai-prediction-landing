# 🏏 Pro Media – Full Stack Setup Guide

## Project Structure

```
promedia/
├── backend/
│   ├── server.js          ← Node.js Express API
│   ├── package.json
│   └── .env.example       ← Copy to .env and fill in keys
├── frontend/
│   ├── index.html         ← Main landing page
│   └── thankyou.html      ← Thank you page (opens in new tab)
└── README.md
```

---

## STEP 1 — Get MSG91 API Keys (Free to start)

1. Go to **https://msg91.com** → Sign Up (free)
2. From Dashboard → **API** → copy your **Auth Key**
3. For **SMS OTP**:
   - Go to **SMS** → **OTP** → Create Template
   - Template text: `Your Pro Media OTP is ##OTP##. Valid for 10 minutes. Do not share. -PROMED`
   - Get the **Template ID**
4. For **WhatsApp OTP** (optional):
   - Go to **WhatsApp** → Register your business number
   - Create an OTP template (category: AUTHENTICATION)
   - Template body: `Your Pro Media verification code is {{1}}. Valid for 10 minutes.`
   - Note your registered WhatsApp number

---

## STEP 2 — Setup Backend on VPS

### Install Node.js on your VPS (Ubuntu)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Upload and install backend
```bash
# On your VPS
mkdir /var/www/promedia-backend
cd /var/www/promedia-backend

# Copy server.js and package.json here, then:
npm install

# Create your .env file
cp .env.example .env
nano .env    # Fill in all values
```

### Your .env should look like:
```
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
MSG91_AUTHKEY=327xxxxxxxxxxxxxxxxxxxxx
MSG91_SMS_TEMPLATE_ID=65a1xxxxxxxxxxxxx
MSG91_SENDER_ID=PROMED
MSG91_WHATSAPP_NUMBER=919876543210
MSG91_WA_TEMPLATE_NAME=otp_verification
```

### Run with PM2 (keeps server running 24/7)
```bash
npm install -g pm2
pm2 start server.js --name "promedia-api"
pm2 startup     # auto-start on reboot
pm2 save
pm2 logs promedia-api   # view live logs
```

---

## STEP 3 — Install Nginx + SSL (HTTPS)

```bash
sudo apt install nginx certbot python3-certbot-nginx -y

# Create nginx config
sudo nano /etc/nginx/sites-available/promedia-api
```

Paste this config:
```nginx
server {
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/promedia-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get free SSL certificate
sudo certbot --nginx -d api.yourdomain.com
```

---

## STEP 4 — Deploy Frontend

### Option A: Netlify (easiest — free)
1. Go to https://netlify.com → New site → Drag & drop the `frontend/` folder
2. Done! Get your URL like `promedia.netlify.app`
3. Buy a domain (₹700/yr from Hostinger) → connect to Netlify

### Option B: Same VPS with Nginx
```bash
sudo mkdir /var/www/promedia-frontend
# Copy frontend files here

sudo nano /etc/nginx/sites-available/promedia-frontend
```
```nginx
server {
    server_name yourdomain.com www.yourdomain.com;
    root /var/www/promedia-frontend;
    index index.html;
    location / { try_files $uri $uri/ =404; }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/promedia-frontend /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo systemctl reload nginx
```

---

## STEP 5 — Connect Frontend to Backend

Open `frontend/index.html` and change line:
```javascript
const API_BASE = 'https://api.yourdomain.com';   // ← update this!
```

---

## STEP 6 — Save Leads to Database (Optional but recommended)

In `server.js`, find the comment `// TODO: Save to your database here` and add:

### Option A: MongoDB Atlas (free tier)
```bash
npm install mongoose
```
```javascript
const mongoose = require('mongoose');
await mongoose.connect(process.env.MONGO_URI);
const Lead = mongoose.model('Lead', { name:String, phone:String, daily_spend:Number, channel:String, submitted_at:Date });
await Lead.create(lead);
```

### Option B: Google Sheets (simple)
Use `googleapis` npm package to append a row — great for non-technical teams.

---

## Cost Breakdown

| Service             | Cost              |
|---------------------|-------------------|
| VPS (DigitalOcean)  | $6/month (~₹500)  |
| Domain (.com/.in)   | ₹700/year         |
| MSG91 SMS OTP       | ~₹0.20 per OTP    |
| MSG91 WhatsApp OTP  | ~₹0.35 per OTP    |
| SSL Certificate     | FREE (Let's Encrypt) |
| **Total to start**  | **~₹600/month**   |

---

## Test Your API

```bash
# Health check
curl https://api.yourdomain.com/health

# Send OTP (SMS)
curl -X POST https://api.yourdomain.com/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","channel":"sms"}'

# Send OTP (WhatsApp)
curl -X POST https://api.yourdomain.com/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","channel":"whatsapp"}'
```

---

## Support
For setup help, contact: support@promedia.in
